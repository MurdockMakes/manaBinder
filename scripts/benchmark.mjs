import { performance } from "node:perf_hooks";
import { createServer } from "node:http";
import { writeFile, mkdir } from "node:fs/promises";
import { testDatabase, prices } from "../test/helpers.js";
import { loadCatalog } from "../src/catalog.js";
import { createApp } from "../src/app.js";
import { transaction } from "../src/db.js";
const start = performance.now(),
  catalog = await loadCatalog(),
  loadMs = performance.now() - start,
  db = await testDatabase();
const config = {
  origin: "http://127.0.0.1:4197",
  secret: "bench-only".repeat(8),
  production: false,
  adminIds: [],
  catalogMaxAgeDays: 180,
};
const server = createServer(
  createApp({
    pool: db.pool,
    catalog,
    config,
    getPrices: prices,
    logger: () => {},
  }),
);
try {
  await transaction(db.pool, async (c) => {
    for (let u = 0; u < 100; u++) {
      await c.query(
        "INSERT INTO users(id,email,nickname,password_hash,verified) VALUES($1,$2,$3,$4,true)",
        [`bench${u}`, `bench${u}@example.test`, `Bench${u}`, "not-a-login"],
      );
      for (let j = 0; j < 20; j++) {
        const card = catalog.cards[j],
          p = card.printings[0];
        await c.query(
          "INSERT INTO inventory(id,user_id,kind,card_id,printing_id,finish,condition,quantity) VALUES($1,$2,'binder',$3,$4,$5,'Near Mint',1)",
          [`bench${u}-${j}`, `bench${u}`, card.id, p.id, p.finishes[0]],
        );
      }
    }
  });
  await new Promise((r) => server.listen(4197, "127.0.0.1", r));
  const endpoints = {};
  for (const path of ["/api/cards?q=ring", "/api/session", "/api/binders"]) {
    const durations = [];
    let bytes;
    for (let i = 0; i < 20; i++) {
      const now = performance.now();
      const r = await fetch(config.origin + path);
      if (!r.ok) throw Error("Benchmark failed " + r.status);
      const text = await r.text();
      bytes = Buffer.byteLength(text);
      durations.push(performance.now() - now);
    }
    durations.sort((a, b) => a - b);
    endpoints[path] = {
      requests: 20,
      p50Ms: +durations[9].toFixed(2),
      p95Ms: +durations[18].toFixed(2),
      bytes,
    };
  }
  const report = {
    at: new Date().toISOString(),
    node: process.version,
    cards: catalog.cards.length,
    printings: catalog.printings.size,
    users: 100,
    inventoryItems: 2000,
    catalogLoadMs: +loadMs.toFixed(2),
    rssBytes: process.memoryUsage().rss,
    endpoints,
    limitations:
      "Local sequential warm requests; not a throughput or cloud capacity claim. Session is anonymous. Includes database seed memory.",
  };
  await mkdir("work", { recursive: true });
  await writeFile("work/benchmark.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.stop();
}
