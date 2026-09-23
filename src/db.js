import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
export function database(connectionString) {
  return new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
}
export async function transaction(pool, fn, { rollback = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Conservative MVP serialization across processes. External I/O never belongs here.
    await client.query("SELECT pg_advisory_xact_lock(4174001)");
    const result = await fn(client);
    await client.query(rollback ? "ROLLBACK" : "COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function migrate(pool) {
  await transaction(pool, async (c) => {
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const directory = new URL("../migrations/", import.meta.url);
    for (const name of (await readdir(directory))
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      if (
        (await c.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]))
          .rowCount
      )
        continue;
      await c.query(await readFile(new URL(name, directory), "utf8"));
      await c.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    }
  });
}
