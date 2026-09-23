import { createServer } from "node:http";
import { config } from "./src/config.js";
import { database, transaction } from "./src/db.js";
import { loadCatalog } from "./src/catalog.js";
import { createApp } from "./src/app.js";
import { priceProvider } from "./src/pricing.js";
import { deliverMail, maintenance } from "./src/accounts.js";
import { expireTrades } from "./src/trades.js";
const settings = config(),
  pool = database(settings.databaseUrl),
  catalog = await loadCatalog();
const schema = await pool.query(
  "SELECT 1 FROM schema_migrations WHERE name='001-initial.sql'",
);
if (schema.rowCount !== 1)
  throw Error("Run database migrations before startup");
const server = createServer(
  createApp({
    pool,
    catalog,
    config: settings,
    getPrices: priceProvider(pool, settings),
  }),
);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.listen(settings.port, settings.host, () =>
  console.log(JSON.stringify({ event: "listening", port: settings.port })),
);
let working = false;
const timer = setInterval(async () => {
  if (working) return;
  working = true;
  try {
    await deliverMail(pool, settings);
    await transaction(pool, expireTrades);
    await maintenance(pool);
  } catch {
    console.error(JSON.stringify({ event: "maintenance_failed" }));
  } finally {
    working = false;
  }
}, 10000);
timer.unref();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  server.close(async () => {
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
