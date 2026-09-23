import { createServer } from "node:http";
import { config } from "./src/config.js";
import { database } from "./src/db.js";
import { loadCatalog } from "./src/catalog.js";
import { createApp } from "./src/app.js";
import { priceProvider } from "./src/pricing.js";
import { telemetry } from "./src/telemetry.js";
const settings = config(),
  pool = database(settings.databaseUrl),
  catalog = await loadCatalog();
const schema = await pool.query(
  "SELECT 1 FROM schema_migrations WHERE name='002-distributed-jobs.sql'",
);
if (schema.rowCount !== 1)
  throw Error("Run database migrations before startup");
const stats = telemetry("api", pool);
const metrics = stats.listen(
  Number(process.env.METRICS_PORT || 9091),
  process.env.METRICS_HOST || "127.0.0.1",
);
stats.setReady(true);
const server = createServer(
  createApp({
    pool,
    catalog,
    config: settings,
    getPrices: priceProvider(pool, settings),
    telemetry: stats,
  }),
);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.listen(settings.port, settings.host, () =>
  console.log(JSON.stringify({ event: "listening", port: settings.port })),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  stats.drain();
  server.close(async () => {
    await new Promise((resolve) => metrics.close(resolve));
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 15000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
