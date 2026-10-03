import test from "node:test";
import assert from "node:assert/strict";
import { fairness, cents, priceProvider } from "../src/pricing.js";
import { config } from "../src/config.js";
import { cookie } from "../src/security.js";
test("production cookies are secure and clear with identical scope", () => {
  let value;
  const res = {
    setHeader: (_k, v) => {
      value = v;
    },
  };
  cookie(res, "test", true);
  assert.match(
    value,
    /HttpOnly; SameSite=Lax; Path=\/; Max-Age=604800; Secure/,
  );
  cookie(res, "", true, true);
  assert.match(value, /Max-Age=0; Secure/);
});
test("provider outages and malformed responses fail closed", async () => {
  for (const fetcher of [
    async () => {
      throw Error("timeout");
    },
    async () => new Response("bad", { status: 200 }),
    async () => new Response("", { status: 500 }),
  ]) {
    const provider = priceProvider(
      { query: async () => ({ rows: [{ delay: 600 }] }) },
      { userAgent: "test" },
      { wait: async () => {}, fetcher },
    );
    await assert.rejects(
      () => provider([{ printing_id: "p" }]),
      (e) => e.status === 503,
    );
  }
});
test("production refuses weak config", () => {
  for (const secret of [
    "",
    "dev-only-change-me-before-production",
    "replace-with-at-least-32-random-bytes",
  ])
    assert.throws(() =>
      config({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://localhost/a",
        APP_ORIGIN: "https://test.example",
        SESSION_SECRET: secret,
      }),
    );
});
test("quantity, exact finish, unknown price and tolerance", () => {
  const item = {
    printing_id: "p",
    finish: "nonfoil",
    condition: "Near Mint",
    selectedQuantity: 1,
  };
  const prices = new Map([["p:nonfoil", 100]]);
  assert.equal(
    fairness([item], [{ ...item, selectedQuantity: 99 }], prices).state,
    "high",
  );
  assert.equal(
    fairness([item], [{ ...item, finish: "foil" }], prices).state,
    "unavailable",
  );
  assert.equal(fairness([item], [item], new Map()).state, "unavailable");
  const other = { ...item, printing_id: "q" };
  for (const [price, state] of [
    [175, "even"],
    [176, "high"],
    [25, "even"],
    [24, "low"],
  ]) {
    prices.set("q:nonfoil", price);
    assert.equal(fairness([item], [other], prices).state, state);
  }
  assert.equal(cents("1.05"), 105);
  assert.equal(cents(null), null);
});
test("provider batches, retries and retains unknown finishes", async () => {
  let calls = 0;
  const sizes = [];
  const pool = { query: async () => ({ rows: [{ delay: 600 }] }) };
  const provider = priceProvider(
    pool,
    { userAgent: "test" },
    {
      wait: async () => {},
      fetcher: async (_url, o) => {
        calls++;
        const ids = JSON.parse(o.body).identifiers;
        sizes.push(ids.length);
        if (calls === 1)
          return new Response("", {
            status: 429,
            headers: { "retry-after": "0" },
          });
        return Response.json({
          data: ids.map((x) => ({
            id: x.id,
            prices: { usd: "1.00", usd_foil: null },
          })),
        });
      },
    },
  );
  const values = await provider(
    Array.from({ length: 76 }, (_, i) => ({ printing_id: String(i) })),
  );
  assert.deepEqual(sizes, [75, 75, 1]);
  assert.equal(values.get("0:foil"), null);
});
