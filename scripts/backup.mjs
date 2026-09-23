import { readFile, writeFile } from "node:fs/promises";
import { database } from "../src/db.js";
import { backup, restore } from "../src/backup.js";
const [action, path] = process.argv.slice(2);
if (!["create", "restore"].includes(action) || !path)
  throw Error(
    "Usage: node scripts/backup.mjs create|restore path; DATABASE_URL and BACKUP_KEY required",
  );
const pool = database(process.env.DATABASE_URL);
try {
  if (action === "create") {
    await writeFile(path, await backup(pool, process.env.BACKUP_KEY), {
      flag: "wx",
      mode: 0o600,
    });
    console.log("Encrypted backup written");
  } else
    console.log(
      JSON.stringify(
        await restore(
          pool,
          await readFile(path, "utf8"),
          process.env.BACKUP_KEY,
        ),
      ),
    );
} finally {
  await pool.end();
}
