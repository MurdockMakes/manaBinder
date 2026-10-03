import { config } from "../src/config.js";
import { database, transaction } from "../src/db.js";
import { broker, names } from "../src/broker.js";
import { relayOnce, processMail, recoverMail } from "../src/jobs.js";
import { maintenance } from "../src/accounts.js";
import { expireTrades } from "../src/trades.js";
import { telemetry } from "../src/telemetry.js";
const role = process.env.SERVICE_ROLE || "worker";
const prefetch = Number(process.env.WORKER_PREFETCH || 4);
if (!Number.isInteger(prefetch) || prefetch < 1 || prefetch > 32)
  throw Error("WORKER_PREFETCH must be an integer from 1 to 32");
if (!["relay", "worker", "scheduler"].includes(role))
  throw Error("Invalid service role");
const settings = config(),
  pool = database(settings.databaseUrl),
  stats = telemetry(role, pool);
const metrics = stats.listen(
  Number(process.env.METRICS_PORT || 9091),
  process.env.METRICS_HOST || "127.0.0.1",
);
let stopping = false,
  activeBroker,
  consumerTag;
const inFlight = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function stop() {
  if (stopping) return;
  stopping = true;
  stats.drain();
  setTimeout(() => process.exit(1), 40000).unref();
  if (consumerTag)
    await activeBroker?.channel.cancel(consumerTag).catch(() => {});
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
await pool.query("SELECT 1 FROM job_outbox LIMIT 0");
while (!stopping) {
  try {
    if (role === "scheduler") {
      // Multiple schedulers are allowed: only this maintenance lease is leader-exclusive.
      const c = await pool.connect();
      try {
        const lock = (
          await c.query("SELECT pg_try_advisory_lock(4174003) AS acquired")
        ).rows[0].acquired;
        if (lock) {
          try {
            await transaction(pool, expireTrades);
            await recoverMail(pool);
            await maintenance(pool);
          } finally {
            await c.query("SELECT pg_advisory_unlock(4174003)");
          }
        }
      } finally {
        c.release();
      }
      await stats.refreshJobs();
      stats.setReady(true);
      await sleep(5000);
      continue;
    }
    if (!process.env.RABBITMQ_URL) throw Error("RABBITMQ_URL required");
    activeBroker = await broker(process.env.RABBITMQ_URL);
    let disconnected = false;
    activeBroker.connection.once("close", () => {
      disconnected = true;
      stats.setReady(false);
    });
    activeBroker.channel.once("close", () => {
      disconnected = true;
      stats.setReady(false);
    });
    stats.setReady(true);
    if (role === "relay") {
      while (!stopping && !disconnected) {
        if (
          !(await relayOnce(pool, (message) => activeBroker.publish(message)))
        )
          await sleep(250);
        else stats.jobs.inc({ outcome: "published" });
      }
    } else {
      const owned = activeBroker;
      await owned.channel.prefetch(prefetch);
      const result = await owned.channel.consume(
        names.queue,
        (message) => {
          if (!message) return;
          const task = (async () => {
            try {
              if (message.content.length > 2048)
                throw Object.assign(Error("Oversized envelope"), {
                  status: 400,
                });
              const value = JSON.parse(message.content.toString());
              const outcome = await processMail(pool, settings, value);
              stats.jobs.inc({ outcome });
              if (outcome === "dead") owned.channel.nack(message, false, false);
              else owned.channel.ack(message);
            } catch (error) {
              stats.jobs.inc({ outcome: "error" });
              try {
                if (error.status === 400 || error instanceof SyntaxError)
                  owned.channel.nack(message, false, false);
                else {
                  await sleep(1000);
                  owned.channel.nack(message, false, true);
                }
              } catch {
                /* Broker disconnect automatically requeues unacked work. */
              }
            }
          })();
          inFlight.add(task);
          task.finally(() => inFlight.delete(task));
        },
        { noAck: false },
      );
      consumerTag = result.consumerTag;
      while (!stopping && !disconnected) await sleep(250);
    }
  } catch {
    stats.setReady(false);
    console.error(JSON.stringify({ event: "service_retry", service: role }));
    await sleep(2000);
  } finally {
    if (activeBroker) {
      await Promise.allSettled([...inFlight]);
      await activeBroker.close();
      activeBroker = null;
      consumerTag = null;
    }
  }
}
stats.drain();
await new Promise((r) => metrics.close(r));
await pool.end();
