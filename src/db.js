import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
export function database(
  connectionString,
  max = Number(process.env.DB_POOL_SIZE || 10),
) {
  if (!Number.isInteger(max) || max < 2 || max > 50)
    throw Error("DB_POOL_SIZE must be an integer from 2 to 50");
  return new pg.Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
}
export async function transaction(
  pool,
  fn,
  { rollback = false, retries = 5 } = {},
) {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await client.query("SET LOCAL lock_timeout = '3s'");
      const result = await fn(client);
      await client.query(rollback ? "ROLLBACK" : "COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      if (["40001", "40P01"].includes(error.code) && attempt < retries) {
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.min(200, 10 * 2 ** attempt) + Math.random() * 20,
          ),
        );
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
export async function migrate(pool) {
  await transaction(pool, async (c) => {
    // DDL alone is serialized. Normal application transactions have no global lock.
    await c.query("SELECT pg_advisory_xact_lock(4174002)");
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
