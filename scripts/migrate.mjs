import { database, migrate } from "../src/db.js";
if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
const pool = database(process.env.DATABASE_URL);
try {
  await migrate(pool);
  console.log("Migrations applied");
} finally {
  await pool.end();
}
