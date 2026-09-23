import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { token, digest, seal, unseal, check } from "./security.js";
import { transaction } from "./db.js";
export async function enqueueAccountMail(c, user, purpose, config) {
  const value = token();
  await c.query("DELETE FROM account_tokens WHERE user_id=$1 AND purpose=$2", [
    user.id,
    purpose,
  ]);
  await c.query(
    "INSERT INTO account_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')",
    [digest(value), user.id, purpose],
  );
  await c.query(
    "INSERT INTO mail_outbox(user_id,purpose,sealed_message) VALUES($1,$2,$3)",
    [
      user.id,
      purpose,
      seal(
        {
          to: user.email,
          purpose,
          url: `${config.origin}/#${purpose}=${value}`,
        },
        config.secret,
      ),
    ],
  );
}
export async function deliverMail(pool, config, { fetcher = fetch } = {}) {
  // A worker owns a row while delivering. Webhook consumers must deduplicate the ID.
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const row = (
      await c.query(
        "SELECT * FROM mail_outbox WHERE status='pending' AND attempts<5 ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1",
      )
    ).rows[0];
    if (!row) {
      await c.query("COMMIT");
      return false;
    }
    try {
      const message = unseal(row.sealed_message, config.secret);
      if (config.mailMode === "file") {
        check(!config.production, 500, "File delivery disabled");
        await mkdir(config.mailDir, { recursive: true });
        await writeFile(
          join(config.mailDir, `${row.id}.json`),
          JSON.stringify(message),
          { mode: 0o600 },
        );
      } else {
        const r = await fetcher(config.mailWebhook, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.mailToken}`,
            "idempotency-key": `manabinder-mail-${row.id}`,
          },
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(8000),
        });
        check(r.ok, 503, "Mail delivery failed");
      }
      await c.query(
        "UPDATE mail_outbox SET status='sent',sealed_message=NULL WHERE id=$1",
        [row.id],
      );
    } catch {
      await c.query(
        "UPDATE mail_outbox SET attempts=attempts+1,status=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END WHERE id=$1",
        [row.id],
      );
    }
    await c.query("COMMIT");
    return true;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function maintenance(pool) {
  return transaction(pool, async (c) => {
    await c.query("DELETE FROM sessions WHERE expires_at<now()");
    await c.query("DELETE FROM account_tokens WHERE expires_at<now()");
    await c.query("DELETE FROM rate_limits WHERE expires_at<now()");
    await c.query(
      "UPDATE trades SET quote=NULL WHERE created_at<now()-interval '30 days'",
    );
    await c.query(
      "DELETE FROM mail_outbox WHERE created_at<now()-interval '1 day'",
    );
    await c.query(
      "DELETE FROM notifications WHERE created_at<now()-interval '90 days'",
    );
    await c.query(
      "DELETE FROM reports WHERE status='resolved' AND created_at<now()-interval '90 days'",
    );
  });
}
