import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./helpers.js";
import { transaction } from "../src/db.js";
import { enqueueAccountMail } from "../src/accounts.js";
import { relayOnce, processMail, recoverMail } from "../src/jobs.js";
import { telemetry } from "../src/telemetry.js";
test("distributed database concurrency and crash recovery", async (t) => {
  const db = await testDatabase();
  const pool = db.pool;
  await pool.query(
    "CREATE TABLE test_independent_writes(id integer PRIMARY KEY,n integer NOT NULL)",
  );
  await pool.query("INSERT INTO test_independent_writes VALUES(1,0),(2,0)");
  t.after(async () => {
    await pool.query("DELETE FROM users WHERE id='distributed-fixture'");
    await pool.query("DROP TABLE test_independent_writes");
    await db.stop();
  });
  await t.test(
    "unrelated transactions make progress concurrently",
    async () => {
      let arrived = 0,
        release;
      const gate = new Promise((r) => {
        release = r;
      });
      const timeout = setTimeout(release, 1500);
      try {
        await Promise.all(
          [1, 2].map((id) =>
            transaction(pool, async (c) => {
              await c.query(
                "UPDATE test_independent_writes SET n=n+1 WHERE id=$1",
                [id],
              );
              arrived++;
              if (arrived === 2) release();
              await gate;
              assert.equal(
                arrived,
                2,
                "A global writer lock still serializes unrelated rows",
              );
            }),
          ),
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  );
  await t.test("serialization retry rolls back before retry", async () => {
    let attempt = 0;
    await transaction(pool, async (c) => {
      await c.query("UPDATE test_independent_writes SET n=n+1 WHERE id=1");
      if (++attempt < 3) throw Object.assign(Error("retry"), { code: "40001" });
    });
    assert.equal(attempt, 3);
    assert.equal(
      (await pool.query("SELECT n FROM test_independent_writes WHERE id=1"))
        .rows[0].n,
      2,
    );
  });
  const settings = {
    secret: "distributed-test".repeat(5),
    origin: "http://localhost",
    mailMode: "webhook",
    mailWebhook: "https://mail.example.test",
    mailToken: "test",
  };
  const user = { id: "distributed-fixture", email: "distributed@example.test" };
  await pool.query(
    "INSERT INTO users(id,email,nickname,password_hash) VALUES($1,$2,'Distributed fixture','unused')",
    [user.id, user.email],
  );
  await t.test("mail and publication commit atomically", async () => {
    await assert.rejects(() =>
      transaction(pool, async (c) => {
        await enqueueAccountMail(c, user, "verify", settings);
        throw Error("rollback");
      }),
    );
    assert.equal(
      (
        await pool.query("SELECT 1 FROM mail_outbox WHERE user_id=$1", [
          user.id,
        ])
      ).rowCount,
      0,
    );
    await transaction(pool, (c) =>
      enqueueAccountMail(c, user, "verify", settings),
    );
    assert.equal((await pool.query("SELECT 1 FROM job_outbox")).rowCount, 1);
  });
  let envelope;
  await t.test("failed broker publish remains recoverable", async () => {
    await assert.rejects(() =>
      relayOnce(pool, async () => {
        throw Error("broker unavailable");
      }),
    );
    assert.equal(
      (await pool.query("SELECT published_at FROM job_outbox")).rows[0]
        .published_at,
      null,
    );
    await pool.query("UPDATE job_outbox SET available_at=now()");
    assert.equal(
      await relayOnce(pool, async (message) => {
        envelope = message;
      }),
      true,
    );
    assert.ok(
      (await pool.query("SELECT published_at FROM job_outbox")).rows[0]
        .published_at,
    );
  });
  await t.test(
    "duplicate deliveries do not run concurrent side effects",
    async () => {
      let calls = 0,
        release;
      const gate = new Promise((r) => {
        release = r;
      });
      let started;
      const start = new Promise((r) => {
        started = r;
      });
      const running = processMail(pool, settings, envelope, {
        fetcher: async () => {
          calls++;
          started();
          await gate;
          return new Response("", { status: 200 });
        },
      });
      await start;
      assert.equal(
        await processMail(pool, settings, envelope, {
          fetcher: async () => {
            throw Error("must not run");
          },
        }),
        "duplicate",
      );
      release();
      assert.equal(await running, "sent");
      assert.equal(calls, 1);
      assert.equal(await processMail(pool, settings, envelope), "duplicate");
    },
  );
  await t.test(
    "crashed leases recover and retries eventually dead-letter",
    async () => {
      await transaction(pool, (c) =>
        enqueueAccountMail(c, user, "reset", settings),
      );
      await relayOnce(pool, async (m) => {
        envelope = m;
      });
      await pool.query(
        "UPDATE mail_outbox SET lease_until=now()-interval '1 second',lease_owner='crashed' WHERE id=$1",
        [envelope.mailId],
      );
      await pool.query(
        "UPDATE job_outbox SET published_at=now()-interval '3 minutes' WHERE id=$1",
        [envelope.eventId],
      );
      await recoverMail(pool);
      assert.equal(
        (
          await pool.query("SELECT published_at FROM job_outbox WHERE id=$1", [
            envelope.eventId,
          ])
        ).rows[0].published_at,
        null,
      );
      for (let i = 1; i <= 5; i++) {
        await pool.query(
          "UPDATE mail_outbox SET available_at=now() WHERE id=$1",
          [envelope.mailId],
        );
        const result = await processMail(pool, settings, envelope, {
          fetcher: async () => new Response("", { status: 503 }),
        });
        assert.equal(result, i === 5 ? "dead" : "retry");
      }
      assert.equal(
        (
          await pool.query(
            "SELECT status,attempts FROM mail_outbox WHERE id=$1",
            [envelope.mailId],
          )
        ).rows[0].status,
        "failed",
      );
    },
  );
  await t.test(
    "metrics use bounded labels and no private URL values",
    async () => {
      const stats = telemetry("test", pool);
      stats.observe(
        {
          method: "GET",
          url: "/api/trades/private-id?email=private@example.test",
        },
        200,
        0.01,
      );
      const text = await stats.registry.metrics();
      assert.ok(text.includes('route="trades"'));
      assert.ok(!text.includes("private-id"));
      assert.ok(!text.includes("private@example.test"));
    },
  );
});
