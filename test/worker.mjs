import { createServer } from "node:http";
import { database } from "../src/db.js";
import { createApp } from "../src/app.js";
import { catalog, prices } from "./helpers.js";
const pool = database(process.env.TEST_DATABASE_URL);
const settings = JSON.parse(process.env.TEST_CONFIG);
const server = createServer(
  createApp({
    pool,
    catalog,
    config: settings,
    getPrices: prices,
    logger: () => {},
  }),
);
server.listen(4200, "127.0.0.1", () => process.send("ready"));
process.on("message", async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end();
  process.exit(0);
});
