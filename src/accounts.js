import { token, digest, seal } from "./security.js";
import { transaction } from "./db.js";
import { queueMail, processMail } from "./jobs.js";
export async function enqueueAccountMail(
  c,
  user,
  purpose,
  config,
  correlationId,
) {
  const value = token();
  await c.query("DELETE FROM account_tokens WHERE user_id=$1 AND purpose=$2", [
    user.id,
    purpose,
  ]);
  await c.query(
    "INSERT INTO account_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')",
    [digest(value), user.id, purpose],
  );
  const job = await c.query(
    "INSERT INTO mail_outbox(user_id,purpose,sealed_message) VALUES($1,$2,$3) RETURNING id",
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
  await queueMail(c, job.rows[0].id, correlationId);
}
// Local test adapter; production delivery runs only through the RabbitMQ worker.
export async function deliverMail(pool, config, options = {}) {
  const row = (
    await pool.query(
      "SELECT id FROM mail_outbox WHERE status='pending' AND available_at<=now() ORDER BY id LIMIT 1",
    )
  ).rows[0];
  if (!row) return false;
  await processMail(
    pool,
    config,
    {
      version: 1,
      type: "account.mail",
      mailId: String(row.id),
      eventId: "0",
      correlationId: "local-test",
    },
    options,
  );
  return true;
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
