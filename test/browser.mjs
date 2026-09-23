import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "@playwright/test";
import { testDatabase, catalog, prices } from "./helpers.js";
import { createApp } from "../src/app.js";
import { unseal } from "../src/security.js";
const db = await testDatabase();
await db.pool.query("TRUNCATE users CASCADE");
await db.pool.query("TRUNCATE rate_limits");
const config = {
  origin: "http://127.0.0.1:4199",
  secret: "browser-test".repeat(5),
  production: false,
  trustProxy: false,
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
await new Promise((r) => server.listen(4199, "127.0.0.1", r));
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(config.origin);
  await page.waitForFunction(
    () => document.querySelector("#sessionBadge").textContent === "Logged out",
  );
  async function signup(p, name) {
    await p.locator("#signupEmail").fill(name + "@example.test");
    await p.locator("#signupNickname").fill(name);
    await p.locator("#signupPassword").fill("browser-password-123");
    await p.locator("#signupForm button").click();
    await p.waitForFunction(
      () =>
        document.querySelector("#sessionBadge").textContent !== "Logged out",
    );
    const u = (
      await db.pool.query("SELECT id FROM users WHERE nickname=$1", [name])
    ).rows[0];
    const m = (
      await db.pool.query(
        "SELECT sealed_message FROM mail_outbox WHERE user_id=$1",
        [u.id],
      )
    ).rows[0];
    await p.goto(unseal(m.sealed_message, config.secret).url);
    await p.reload();
    await p.waitForFunction(
      () =>
        document.querySelector("#authMessage").textContent ===
        "Email verified.",
    );
    return u;
  }
  const a = await signup(page, "BrowserA");
  await page.locator('[data-view="storesView"]').click();
  await page.locator('[data-store-checkbox][value="store-a"]').check();
  await page.locator("#storeSearch").fill("Beta");
  await page.locator('[data-store-checkbox][value="store-b"]').check();
  await page.locator("#saveStoresButton").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#authMessage").textContent === "Stores saved.",
  );
  assert.equal(
    Number(
      (
        await db.pool.query(
          "SELECT count(*) n FROM user_stores WHERE user_id=$1",
          [a.id],
        )
      ).rows[0].n,
    ),
    2,
  );
  await page.locator('[data-view="binderView"]').click();
  await page.locator("[data-add-card]").first().click();
  await page.waitForFunction(() =>
    document.querySelector("#myBinder").textContent.includes("Test Card"),
  );
  const contextB = await browser.newContext();
  const bpage = await contextB.newPage();
  bpage.on("pageerror", (e) => errors.push(e.message));
  await bpage.goto(config.origin);
  await bpage.waitForFunction(
    () => document.querySelector("#sessionBadge").textContent === "Logged out",
  );
  const b = await signup(bpage, "BrowserB");
  await bpage.locator('[data-view="binderView"]').click();
  await bpage.locator("[data-add-card]").first().click();
  await bpage.waitForFunction(() =>
    document.querySelector("#myBinder").textContent.includes("Test Card"),
  );
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector("#sessionBadge").textContent === "BrowserA",
  );
  await page.locator('[data-view="searchView"]').click();
  await page.locator(`[data-start-request="${b.id}"]`).click();
  let releaseQuote;
  const gate=new Promise(resolve=>{releaseQuote=resolve;});
  await page.route('**/api/trades/quote',async route=>{await gate;await route.fulfill({json:{state:'even',message:'Stale even quote'}});});
  const quoteStarted=page.waitForRequest('**/api/trades/quote');
  await page.locator('[data-trade-choice="offered"]').check();await quoteStarted;
  await page.locator('[data-trade-choice="offered"]').uncheck();releaseQuote();
  await page.waitForResponse('**/api/trades/quote');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#sendTradeButton').isDisabled(),true);
  await page.unroute('**/api/trades/quote');
  await page.locator('[data-trade-choice="offered"]').check();
  await page.waitForFunction(
    () => !document.querySelector("#sendTradeButton").disabled,
  );
  await page.locator("#sendTradeButton").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#authMessage").textContent ===
      "Trade request sent.",
  );
  await bpage.locator('[data-view="historyView"]').click();
  await bpage.getByRole("button", { name: "accept", exact: true }).click();
  await bpage.getByRole("button", { name: "Confirm physical handoff" }).click();
  await page.locator('[data-view="historyView"]').click();
  await page.getByRole("button", { name: "Confirm physical handoff" }).click();
  await page.waitForFunction(() =>
    document.querySelector("#tradeHistory").textContent.includes("completed"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.locator('[data-view="profileView"]').click();
  await page.locator("#logoutButton").click();
  await page.waitForFunction(
    () => document.querySelector("#sessionBadge").textContent === "Logged out",
  );
  assert.ok(!(await page.locator("#tradeHistory").textContent()));
  assert.deepEqual(errors, []);
  console.log(
    "Browser: signup/verify, filtered stores, two-user trade/handoff, mobile width, logout passed",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await db.stop();
}
