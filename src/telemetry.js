import client from "@prometheus-io/client";
import { createServer } from "node:http";
export function telemetry(role, pool) {
  const registry = new client.Registry();
  registry.setDefaultLabels({ service: role });
  client.collectDefaultMetrics({ register: registry });
  const requests = new client.Counter({
    name: "manabinder_http_requests_total",
    help: "HTTP requests by bounded route group",
    labelNames: ["method", "route", "status"],
    registers: [registry],
  });
  const duration = new client.Histogram({
    name: "manabinder_http_seconds",
    help: "HTTP handler latency",
    labelNames: ["method", "route"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
    registers: [registry],
  });
  const jobs = new client.Counter({
    name: "manabinder_jobs_total",
    help: "Job processing outcomes",
    labelNames: ["outcome"],
    registers: [registry],
  });
  const backlog = new client.Gauge({
    name: "manabinder_mail_pending",
    help: "Pending mail including leased work",
    registers: [registry],
  });
  const oldest = new client.Gauge({
    name: "manabinder_mail_oldest_seconds",
    help: "Age of oldest pending mail",
    registers: [registry],
  });
  const failed = new client.Gauge({
    name: "manabinder_mail_failed",
    help: "Exhausted mail jobs retained for operator review",
    registers: [registry],
  });
  new client.Gauge({
    name: "manabinder_db_connections",
    help: "Pool total connections",
    registers: [registry],
    collect() {
      this.set(pool.totalCount);
    },
  });
  new client.Gauge({
    name: "manabinder_db_waiting",
    help: "Requests waiting for a connection",
    registers: [registry],
    collect() {
      this.set(pool.waitingCount);
    },
  });
  let ready = false,
    draining = false;
  return {
    registry,
    jobs,
    async refreshJobs() {
      const r = (
        await pool.query(
          "SELECT count(*) FILTER(WHERE status='pending') AS pending,count(*) FILTER(WHERE status='failed') AS failed,COALESCE(EXTRACT(EPOCH FROM (now()-min(created_at) FILTER(WHERE status='pending'))),0) AS oldest FROM mail_outbox",
        )
      ).rows[0];
      backlog.set(Number(r.pending));
      failed.set(Number(r.failed));
      oldest.set(Number(r.oldest));
    },
    setReady(value) {
      ready = value;
    },
    drain() {
      draining = true;
    },
    observe(req, status, seconds) {
      const method = ["GET", "POST", "PATCH", "DELETE", "HEAD"].includes(
        req.method,
      )
        ? req.method
        : "OTHER";
      const path = (req.url || "").split("?")[0],
        route =
          [
            "session",
            "cards",
            "signup",
            "login",
            "logout",
            "account",
            "me",
            "binders",
            "trades",
            "notifications",
            "blocks",
            "reports",
            "admin",
          ].find(
            (name) =>
              path === `/api/${name}` || path.startsWith(`/api/${name}/`),
          ) || "other";
      requests.inc({ method, route, status: String(status) });
      duration.observe({ method, route }, seconds);
    },
    listen(port, host = "127.0.0.1") {
      const server = createServer(async (req, res) => {
        try {
          if (req.url === "/metrics") {
            res.setHeader("content-type", registry.contentType);
            res.end(await registry.metrics());
            return;
          }
          if (req.url === "/healthz") {
            res.end("ok");
            return;
          }
          if (req.url === "/readyz") {
            if (!ready || draining) throw Error("Not ready");
            await pool.query("SELECT 1");
            res.end("ready");
            return;
          }
          res.writeHead(404);
          res.end();
        } catch {
          res.writeHead(503);
          res.end("unavailable");
        }
      });
      server.listen(port, host);
      return server;
    },
  };
}
