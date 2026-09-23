import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { testDatabase, catalog, printing, prices } from "./helpers.js";
import { createApp } from "../src/app.js";
import { unseal, digest } from "../src/security.js";
import { fork } from "node:child_process";
import { backup, restore } from "../src/backup.js";
import { database, migrate } from "../src/db.js";
import { importLegacy } from "../scripts/import-legacy.mjs";
import { deliverMail } from "../src/accounts.js";
test("PostgreSQL security, concurrency and full trading regression", async (t) => {
  const db = await testDatabase();
  const settings = {
    origin: "http://127.0.0.1:4198",
    secret: "test".repeat(16),
    production: false,
    trustProxy: false,
    adminIds: [],
    catalogMaxAgeDays: 180,
  };
  const logs = [];
  const server = createServer(
    createApp({
      pool: db.pool,
      catalog,
      config: settings,
      getPrices: prices,
      logger: (s) => logs.push(s),
    }),
  );
  await new Promise((r) => server.listen(4198, "127.0.0.1", r));
  const worker = fork(new URL("./worker.mjs", import.meta.url), [], {
    env: {
      ...process.env,
      TEST_DATABASE_URL: db.url,
      TEST_CONFIG: JSON.stringify(settings),
    },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  await new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
  });
  t.after(async () => {
    worker.send("stop");
    await new Promise((r) => worker.once("exit", r));
    await new Promise((r) => server.close(r));
    await db.stop();
  });
  function client(base = settings.origin) {
    let cookie = "",
      csrf = "";
    return {
      get cookie() {
        return cookie;
      },
      set cookie(v) {
        cookie = v;
      },
      async request(path, method = "GET", body, headers = {}) {
        const r = await fetch(base + path, {
          method,
          headers: {
            cookie,
            origin: settings.origin,
            "content-type": "application/json",
            "x-csrf-token": csrf,
            ...headers,
          },
          body:
            method === "GET"
              ? undefined
              : typeof body === "string"
                ? body
                : JSON.stringify(body || {}),
        });
        const result = await r.json();
        if (r.headers.get("set-cookie"))
          cookie = r.headers.get("set-cookie").split(";")[0];
        if (result.csrfToken) csrf = result.csrfToken;
        return { status: r.status, body: result };
      },
    };
  }
  const signup = async (name, base) => {
    const c = client(base);
    await c.request("/api/session");
    const r = await c.request("/api/signup", "POST", {
      email: `${name}@example.test`,
      nickname: name,
      password: "test-password-123",
    });
    assert.equal(r.status, 201, JSON.stringify(r));
    await c.request("/api/session");
    c.user = r.body.user;
    return c;
  };
  const verify = async (c) => {
    const row = (
      await db.pool.query(
        "SELECT sealed_message FROM mail_outbox WHERE user_id=$1 ORDER BY id DESC LIMIT 1",
        [c.user.id],
      )
    ).rows[0];
    const token = new URL(
      unseal(row.sealed_message, settings.secret).url,
    ).hash.split("=")[1];
    assert.equal(
      (await c.request("/api/account/verify", "POST", { token })).status,
      200,
    );
  };
  const all = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      signup(`Audit${i}`, i % 2 ? "http://127.0.0.1:4200" : settings.origin),
    ),
  );
  assert.equal(
    Number((await db.pool.query("SELECT count(*) n FROM users")).rows[0].n),
    8,
  );
  const [a, b, c] = all;
  await verify(a);
  await verify(b);
  await verify(c);
  await t.test("duplicate account races conflict", async () => {
    const attempts = all.slice(0, 2).map((x) =>
      x.request("/api/signup", "POST", {
        email: "duplicate@example.test",
        nickname: "Duplicate",
        password: "test-password-123",
      }),
    );
    const statuses = (await Promise.all(attempts)).map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409]);
    for (const x of all.slice(0, 2)) {
      await x.request("/api/session");
      await x.request("/api/login", "POST", {
        email: x.user.email,
        password: "test-password-123",
      });
      await x.request("/api/session");
    }
  });
  await t.test("request guards", async () => {
    assert.equal((await a.request("/api/login", "POST", "{")).status, 400);
    assert.equal(
      (
        await a.request(
          "/api/me/stores",
          "PATCH",
          { storeIds: [] },
          { origin: "https://foreign.test" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await a.request(
          "/api/me/stores",
          "PATCH",
          { storeIds: [] },
          { "content-type": "text/plain" },
        )
      ).status,
      415,
    );
    assert.equal(
      (
        await a.request("/api/me/stores", "PATCH", {
          storeIds: [],
          extra: "x".repeat(33000),
        })
      ).status,
      413,
    );
    assert.equal((await client().request("/api/trades")).status, 401);
    assert.equal(
      (await a.request(`/api/binders?wantedByUserId=${b.user.id}`)).status,
      403,
    );
  });
  const add = async (c, kind = "binder", quantity = 1) => {
    const r = await c.request(`/api/me/${kind}`, "POST", {
      cardId: "card-one",
      printingId: printing,
      finish: "nonfoil",
      condition: "Near Mint",
      quantity,
      location: kind === "collection" ? "PRIVATE_LOCATION" : "",
    });
    assert.equal(r.status, 201, JSON.stringify(r));
    return r.body.user[kind].at(-1);
  };
  const ai = await add(a, "collection", 99),
    bi = await add(b),
    ci = await add(c);
  await t.test("independent concurrent inventory writes persist", async () => {
    const before = Number(
      (
        await db.pool.query(
          "SELECT count(*) n FROM inventory WHERE user_id=$1",
          [all[3].user.id],
        )
      ).rows[0].n,
    );
    await Promise.all(Array.from({ length: 8 }, () => add(all[3])));
    assert.equal(
      Number(
        (
          await db.pool.query(
            "SELECT count(*) n FROM inventory WHERE user_id=$1",
            [all[3].user.id],
          )
        ).rows[0].n,
      ),
      before + 8,
    );
  });
  const draft = {
    targetUserId: b.user.id,
    requestedItems: [{ id: bi.id, quantity: 1 }],
    offeredItems: [{ id: ai.id, quantity: 1 }],
  };
  assert.equal(
    (
      await a.request("/api/trades/quote", "POST", {
        ...draft,
        offeredItems: [{ id: ai.id, quantity: 99 }],
      })
    ).body.state,
    "high",
  );
  assert.equal(
    (
      await a.request("/api/trades/quote", "POST", {
        ...draft,
        requestedItems: [{ id: ai.id, quantity: 1 }],
      })
    ).status,
    409,
  );
  const sent = await a.request("/api/trades", "POST", draft, {
    "idempotency-key": "unique-request-1",
  });
  assert.equal(sent.status, 201, JSON.stringify(sent));
  const tid = sent.body.id;
  assert.equal(
    (
      await a.request("/api/trades", "POST", draft, {
        "idempotency-key": "unique-request-1",
      })
    ).body.id,
    tid,
  );
  assert.equal((await c.request(`/api/trades/${tid}`)).status, 404);
  const second = await c.request(
    "/api/trades",
    "POST",
    { ...draft, offeredItems: [{ id: ci.id, quantity: 1 }] },
    { "idempotency-key": "unique-request-2" },
  );
  assert.equal(second.status, 201);
  const accepted = await Promise.all(
    [tid, second.body.id].map((id) =>
      b.request(`/api/trades/${id}/accept`, "POST"),
    ),
  );
  assert.deepEqual(accepted.map((r) => r.status).sort(), [200, 409]);
  const winner = accepted[0].status === 200 ? tid : second.body.id,
    owner = winner === tid ? a : c;
  assert.equal(
    (await owner.request(`/api/trades/${winner}/complete`, "POST")).body.status,
    "accepted",
  );
  assert.equal(
    (await b.request(`/api/trades/${winner}/complete`, "POST")).body.status,
    "completed",
  );
  assert.equal(
    (await b.request(`/api/trades/${winner}/complete`, "POST")).body.status,
    "completed",
  );
  assert.equal(
    (await db.pool.query("SELECT quantity FROM inventory WHERE id=$1", [bi.id]))
      .rows[0].quantity,
    0,
  );
  await t.test("cancellation and expiry release reservations", async () => {
    const fresh = await add(b);
    const request = {
      ...draft,
      requestedItems: [{ id: fresh.id, quantity: 1 }],
    };
    const sent = await a.request("/api/trades", "POST", request, {
      "idempotency-key": "cancellation-test",
    });
    assert.equal(sent.status, 201);
    const id = sent.body.id;
    assert.equal(
      (await b.request(`/api/trades/${id}/accept`, "POST")).status,
      200,
    );
    assert.equal(
      (await a.request(`/api/trades/${id}/cancel`, "POST")).status,
      200,
    );
    const again = await a.request("/api/trades", "POST", request, {
      "idempotency-key": "expiry-test",
    });
    assert.equal(again.status, 201);
    await b.request(`/api/trades/${again.body.id}/accept`, "POST");
    await db.pool.query(
      "UPDATE trades SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [again.body.id],
    );
    await a.request("/api/trades");
    assert.equal(
      (
        await db.pool.query("SELECT status FROM trades WHERE id=$1", [
          again.body.id,
        ])
      ).rows[0].status,
      "expired",
    );
    assert.equal(
      (await a.request("/api/trades/quote", "POST", request)).body.state,
      "even",
    );
  });
  await t.test("reset is single use and revokes sessions", async () => {
    const x = all[4];
    await x.request("/api/account/reset-request", "POST", {
      email: x.user.email,
    });
    const row = (
      await db.pool.query(
        "SELECT sealed_message FROM mail_outbox WHERE user_id=$1 AND purpose='reset' ORDER BY id DESC LIMIT 1",
        [x.user.id],
      )
    ).rows[0];
    const value = new URL(
      unseal(row.sealed_message, settings.secret).url,
    ).hash.split("=")[1];
    const stolen = x.cookie;
    assert.equal(
      (
        await x.request("/api/account/reset", "POST", {
          token: value,
          password: "new-password-123",
        })
      ).status,
      200,
    );
    x.cookie = stolen;
    assert.equal((await x.request("/api/session")).body.user, null);
    assert.equal(
      (
        await x.request("/api/account/reset", "POST", {
          token: value,
          password: "new-password-123",
        })
      ).status,
      400,
    );
  });
  await t.test("block, report and admin authorization", async () => {
    assert.equal(
      (
        await c.request("/api/reports", "POST", {
          targetId: a.user.id,
          reason: "Test moderation report",
        })
      ).status,
      201,
    );
    assert.equal((await c.request("/api/admin/reports")).status, 403);
    assert.equal(
      (await c.request("/api/blocks", "POST", { targetId: a.user.id })).status,
      200,
    );
    assert.equal(
      (await c.request("/api/binders")).body.binders.some(
        (u) => u.id === a.user.id,
      ),
      false,
    );
    assert.equal(
      (await c.request("/api/blocks", "DELETE", { targetId: a.user.id }))
        .status,
      200,
    );
  });
  const publicPayload = JSON.stringify((await a.request("/api/binders")).body);
  assert.ok(!publicPayload.includes("PRIVATE_LOCATION"));
  assert.ok(!publicPayload.includes("email"));
  assert.ok(!publicPayload.includes("prices"));
  await t.test("mail webhook sandbox retries then clears encrypted payload",async()=>{
    const mailConfig={...settings,mailMode:'webhook',mailWebhook:'https://mail.example.test',mailToken:'sandbox-only'};
    let failedId;await deliverMail(db.pool,mailConfig,{fetcher:async(_url,options)=>{failedId=options.headers['idempotency-key'];return new Response('',{status:503});}});
    let delivered;await deliverMail(db.pool,mailConfig,{fetcher:async(_url,options)=>{assert.equal(options.headers['idempotency-key'],failedId);delivered=JSON.parse(options.body);return new Response('',{status:200});}});
    assert.ok(delivered.url.startsWith(settings.origin));assert.ok(delivered.to.endsWith('@example.test'));assert.equal((await db.pool.query("SELECT sealed_message FROM mail_outbox WHERE status='sent' LIMIT 1")).rows[0].sealed_message,null);
  });
  await t.test("logout and expired sessions cannot replay", async () => {
    const stolen = a.cookie;
    await a.request("/api/logout", "POST");
    a.cookie = stolen;
    assert.equal((await a.request("/api/session")).body.user, null);
    await db.pool.query(
      "UPDATE sessions SET expires_at=now()-interval '1 day' WHERE token_hash=$1",
      [digest(b.cookie.split("=")[1])],
    );
    assert.equal((await b.request("/api/session")).body.user, null);
  });
  assert.ok(
    logs.every(
      (l) =>
        !l.includes("test-password") &&
        !l.includes("@example.test") &&
        !l.includes("PRIVATE_LOCATION"),
    ),
  );
  await t.test(
    "encrypted backup restores into fresh database and migration rolls back",
    async () => {
      const key = "backup-test-key".repeat(4),
        sealed = await backup(db.pool, key);
      assert.ok(!sealed.includes("@example.test"));
      const name = "restore_" + Date.now();
      await db.pool.query(`CREATE DATABASE ${name}`);
      const url = new URL(db.url);
      url.pathname = "/" + name;
      const restored = database(url.href);
      try {
        await migrate(restored);
        const result = await restore(restored, sealed, key);
        assert.equal(result.users, 9);
        assert.equal(
          Number(
            (await restored.query("SELECT count(*) n FROM users")).rows[0].n,
          ),
          9,
        );
        await assert.rejects(() => restore(restored, sealed, key), /empty/);
        const legacyUser = {
          id: "legacy-a",
          email: "legacy@example.test",
          nickname: "Legacy",
          passwordHash: (
            await db.pool.query("SELECT password_hash FROM users LIMIT 1")
          ).rows[0].password_hash,
          createdAt: new Date().toISOString(),
          storeIds: ["store-a"],
          binder: [
            {
              id: "legacy-item",
              cardId: "card-one",
              printingId: printing,
              finish: "nonfoil",
              condition: "Near Mint",
              quantity: 2,
              addedAt: new Date().toISOString(),
            },
          ],
        };
        const raw = JSON.stringify({ users: [legacyUser], trades: [] });
        assert.equal(
          (await importLegacy(restored, catalog, raw)).counts.users,
          1,
        );
        assert.equal(
          (await restored.query("SELECT 1 FROM users WHERE id='legacy-a'"))
            .rowCount,
          0,
        );
        await importLegacy(restored, catalog, raw, { apply: true });
        assert.equal(
          (await importLegacy(restored, catalog, raw, { apply: true }))
            .alreadyImported,
          true,
        );
      } finally {
        await restored.end();
        await db.pool.query(`DROP DATABASE ${name}`);
      }
    },
  );
});
