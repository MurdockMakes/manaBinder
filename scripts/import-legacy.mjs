import { readFile } from "node:fs/promises";
import { database, transaction } from "../src/db.js";
import { loadCatalog } from "../src/catalog.js";
import { digest, check } from "../src/security.js";
export async function importLegacy(
  pool,
  catalog,
  raw,
  { apply = false, mapping = {} } = {},
) {
  const source = JSON.parse(raw);
  check(
    Array.isArray(source.users) && Array.isArray(source.trades),
    400,
    "Invalid legacy data",
  );
  // Legacy trades have no enforceable state or quantity semantics: require an explicit operator migration first.
  check(
    source.trades.length === 0,
    400,
    "Legacy trades require an explicit reviewed mapping before import",
  );
  const hash = digest(raw),
    counts = { users: 0, inventory: 0, wants: 0 };
  return transaction(
    pool,
    async (c) => {
      if (
        (
          await c.query("SELECT 1 FROM legacy_imports WHERE source_hash=$1", [
            hash,
          ])
        ).rowCount
      )
        return { alreadyImported: true };
      for (const u of source.users) {
        check(
          !u.id.startsWith("test_user_"),
          400,
          "Remove demo users from a separate reviewed import copy",
        );
        check(
          /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(u.passwordHash),
          400,
          "Invalid password hash",
        );
        check(
          typeof u.email === "string" &&
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email) &&
            typeof u.nickname === "string",
          400,
          "Invalid account",
        );
        await c.query(
          "INSERT INTO users(id,email,nickname,password_hash,created_at) VALUES($1,$2,$3,$4,$5)",
          [
            u.id,
            u.email.toLowerCase(),
            u.nickname,
            u.passwordHash,
            u.createdAt,
          ],
        );
        counts.users++;
        for (const sid of [...new Set(u.storeIds || [])]) {
          check(catalog.storeIds.has(sid), 400, "Unknown legacy store");
          await c.query(
            "INSERT INTO user_stores(user_id,store_id) VALUES($1,$2)",
            [u.id, sid],
          );
        }
        for (const kind of ["binder", "collection"])
          for (const item of u[kind] || []) {
            const map = mapping[item.printingId] || {},
              printingId = map.printingId || item.printingId,
              cardId = map.cardId || item.cardId,
              finish = map.finish || item.finish;
            const p = catalog.printings.get(printingId);
            check(
              p?.cardId === cardId && p.finishes.includes(finish),
              400,
              "Explicit printing/card/finish mapping required",
            );
            await c.query(
              "INSERT INTO inventory(id,user_id,kind,card_id,printing_id,finish,condition,quantity,note,location,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
              [
                item.id,
                u.id,
                kind,
                cardId,
                printingId,
                finish,
                item.condition,
                item.quantity || 1,
                item.note || "",
                item.location || "",
                item.addedAt,
              ],
            );
            counts.inventory++;
          }
        for (const w of u.lookingFor || []) {
          check(catalog.byId.has(w.cardId), 400, "Unknown wanted card");
          await c.query(
            "INSERT INTO wants(id,user_id,card_id,priority,note) VALUES($1,$2,$3,$4,$5)",
            [w.id, u.id, w.cardId, w.priority, w.note || ""],
          );
          counts.wants++;
        }
      }
      await c.query(
        "INSERT INTO legacy_imports(source_hash,counts) VALUES($1,$2)",
        [hash, counts],
      );
      return { apply, counts };
    },
    { rollback: !apply },
  );
}
if (process.argv[1]?.endsWith("import-legacy.mjs")) {
  const file = process.argv[2];
  if (!file)
    throw Error(
      "Usage: node scripts/import-legacy.mjs input.json [--apply] [--mapping=path.json]",
    );
  const mappingArg = process.argv.find((x) => x.startsWith("--mapping="));
  const mapping = mappingArg
    ? JSON.parse(await readFile(mappingArg.slice(10), "utf8"))
    : {};
  const pool = database(process.env.DATABASE_URL);
  try {
    console.log(
      JSON.stringify(
        await importLegacy(
          pool,
          await loadCatalog(),
          await readFile(file, "utf8"),
          { apply: process.argv.includes("--apply"), mapping },
        ),
      ),
    );
  } finally {
    await pool.end();
  }
}
