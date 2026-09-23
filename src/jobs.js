import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { check, unseal } from "./security.js";
import { transaction } from "./db.js";
export async function queueMail(
  c,
  mailId,
  correlationId = randomUUID(),
  eventKey = `mail:${mailId}:initial`,
  delaySeconds = 0,
) {
  await c.query(
    `INSERT INTO job_outbox(mail_id,event_key,correlation_id,available_at) VALUES($1,$2,$3,now()+$4*interval '1 second') ON CONFLICT(event_key) DO NOTHING`,
    [mailId, eventKey, correlationId, delaySeconds],
  );
}
// Claim in a short transaction, then release the DB connection before broker I/O.
export async function relayOnce(pool, publish) {
  const owner = randomUUID();
  const row = (
    await pool.query(
      `UPDATE job_outbox SET lease_owner=$1,lease_until=now()+interval '30 seconds'
 WHERE id=(SELECT id FROM job_outbox WHERE published_at IS NULL AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
 RETURNING *`,
      [owner],
    )
  ).rows[0];
  if (!row) return false;
  try {
    await publish({
      version: 1,
      type: "account.mail",
      mailId: String(row.mail_id),
      eventId: String(row.id),
      correlationId: row.correlation_id,
    });
    await pool.query(
      "UPDATE job_outbox SET published_at=now(),lease_until=NULL,lease_owner=NULL WHERE id=$1 AND lease_owner=$2",
      [row.id, owner],
    );
  } catch (error) {
    await pool.query(
      "UPDATE job_outbox SET available_at=now()+interval '5 seconds',lease_until=NULL,lease_owner=NULL WHERE id=$1 AND lease_owner=$2",
      [row.id, owner],
    );
    throw error;
  }
  return true;
}
export async function processMail(
  pool,
  config,
  message,
  { fetcher = fetch } = {},
) {
  check(
    message?.version === 1 &&
      message.type === "account.mail" &&
      /^\d+$/.test(message.mailId) &&
      /^\d+$/.test(message.eventId) &&
      typeof message.correlationId === "string" &&
      message.correlationId.length <= 100,
    400,
    "Invalid job envelope",
  );
  const owner = randomUUID();
  const row = (
    await pool.query(
      `UPDATE mail_outbox SET lease_owner=$2,lease_until=now()+interval '30 seconds',attempts=attempts+1
 WHERE id=$1 AND status='pending' AND attempts<5 AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) RETURNING *`,
      [message.mailId, owner],
    )
  ).rows[0];
  if (!row) {
    const current = (
      await pool.query("SELECT status FROM mail_outbox WHERE id=$1", [
        message.mailId,
      ])
    ).rows[0];
    return current?.status === "failed" ? "dead" : "duplicate";
  }
  let success = false;
  try {
    const payload = unseal(row.sealed_message, config.secret);
    if (config.mailMode === "file") {
      check(!config.production, 500, "File delivery forbidden in production");
      await mkdir(config.mailDir, { recursive: true });
      await writeFile(
        join(config.mailDir, `${row.id}.json`),
        JSON.stringify(payload),
        { mode: 0o600 },
      );
    } else {
      const response = await fetcher(config.mailWebhook, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.mailToken}`,
          "idempotency-key": `manabinder-mail-${row.id}`,
          "x-correlation-id": message.correlationId,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });
      check(response.ok, 503, "Mail provider unavailable");
    }
    success = true;
  } catch {
    /* Payloads and credentials must never be logged. */
  }
  return transaction(pool, async (c) => {
    if (success) {
      await c.query(
        "UPDATE mail_outbox SET status='sent',sealed_message=NULL,lease_owner=NULL,lease_until=NULL WHERE id=$1 AND lease_owner=$2",
        [row.id, owner],
      );
      return "sent";
    }
    const dead = row.attempts >= 5,
      delay = Math.min(300, 2 ** row.attempts);
    const changed = await c.query(
      `UPDATE mail_outbox SET status=$3,lease_owner=NULL,lease_until=NULL,available_at=now()+$4*interval '1 second' WHERE id=$1 AND lease_owner=$2`,
      [row.id, owner, dead ? "failed" : "pending", delay],
    );
    if (changed.rowCount && !dead)
      await queueMail(
        c,
        row.id,
        message.correlationId,
        `mail:${row.id}:attempt:${row.attempts}`,
        delay,
      );
    return dead ? "dead" : "retry";
  });
}
// Recover abandoned leases and rare confirmed-but-lost broker deliveries. Duplicate
// messages are intentional: the job state plus downstream idempotency is authoritative.
export async function recoverMail(pool) {
  await pool.query(
    `UPDATE mail_outbox SET status='failed',lease_owner=NULL,lease_until=NULL WHERE status='pending' AND attempts>=5 AND lease_until<now()`,
  );
  await pool.query(`UPDATE job_outbox j SET published_at=NULL,lease_until=NULL,lease_owner=NULL,available_at=now()
 FROM mail_outbox m WHERE j.mail_id=m.id AND m.status='pending' AND m.attempts<5 AND m.available_at<=now()
 AND (m.lease_until IS NULL OR m.lease_until<now()) AND j.published_at<now()-interval '2 minutes'
 AND j.id=(SELECT max(j2.id) FROM job_outbox j2 WHERE j2.mail_id=m.id)`);
}
