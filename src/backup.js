import { seal, unseal, check } from "./security.js";
export const backupTables = [
  "users",
  "sessions",
  "user_stores",
  "inventory",
  "wants",
  "trades",
  "trade_items",
  "trade_events",
  "notifications",
  "account_tokens",
  "mail_outbox",
  "blocks",
  "reports",
  "moderation_events",
  "legacy_imports",
];
export async function backup(pool, key) {
  check(key?.length >= 43, 400, "BACKUP_KEY must have at least 43 characters");
  const c = await pool.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables = {};
    for (const t of backupTables)
      tables[t] = (await c.query(`SELECT * FROM ${t}`)).rows;
    await c.query("COMMIT");
    return seal(
      { version: 1, createdAt: new Date().toISOString(), tables },
      key,
    );
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function restore(pool, sealed, key) {
  check(key?.length >= 43, 400, "BACKUP_KEY required");
  const data = unseal(sealed, key);
  check(
    data.version === 1 &&
      Object.keys(data.tables).length === backupTables.length,
    400,
    "Unsupported backup",
  );
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(4174001)");
    for (const t of backupTables) {
      check(Array.isArray(data.tables[t]), 400, "Invalid backup table");
      check(
        !(await c.query(`SELECT 1 FROM ${t} LIMIT 1`)).rowCount,
        409,
        "Restore requires empty migrated database",
      );
    }
    for (const t of backupTables) {
      const columns = new Set(
        (
          await c.query(
            "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1",
            [t],
          )
        ).rows.map((r) => r.column_name),
      );
      for (const row of data.tables[t]) {
        const keys = Object.keys(row);
        check(
          keys.length && keys.every((k) => columns.has(k)),
          400,
          "Invalid backup columns",
        );
        await c.query(
          `INSERT INTO ${t} (${keys.map((k) => '"' + k + '"').join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")})`,
          keys.map((k) => row[k]),
        );
      }
      const seq = columns.has("id")
        ? (await c.query("SELECT pg_get_serial_sequence($1,'id') AS name", [t]))
            .rows[0].name
        : null;
      if (seq)
        await c.query(
          `SELECT setval($1,COALESCE((SELECT max(id) FROM ${t}),1),EXISTS(SELECT 1 FROM ${t}))`,
          [seq],
        );
    }
    // Restoring a snapshot must never resurrect old bearer credentials or reset links.
    await c.query("DELETE FROM sessions");
    await c.query("DELETE FROM account_tokens");
    await c.query("DELETE FROM mail_outbox");
    await c.query("COMMIT");
    return Object.fromEntries(
      backupTables.map((t) => [
        t,
        ["sessions", "account_tokens", "mail_outbox"].includes(t)
          ? 0
          : data.tables[t].length,
      ]),
    );
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
