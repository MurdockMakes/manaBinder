import EmbeddedPostgres from "embedded-postgres";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { database, migrate } from "../src/db.js";
import { Catalog } from "../src/catalog.js";
export const printing = "11111111-1111-4111-8111-111111111111";
export const catalog = new Catalog(
  [
    {
      id: "card-one",
      name: "Test Card",
      type: "Artifact",
      colors: ["colorless"],
      printings: [
        {
          id: printing,
          set: "Test Set",
          number: "1",
          treatment: "Regular",
          finishes: ["nonfoil", "foil", "etched"],
        },
      ],
    },
  ],
  [
    { id: "store-a", name: "Alpha", address: "Boston MA" },
    { id: "store-b", name: "Beta", address: "Amherst MA" },
  ],
);
export const prices = async (items) =>
  new Map(items.map((i) => [`${i.printing_id}:${i.finish}`, 100]));
export async function testDatabase() {
  let embedded;
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    await mkdir("work", { recursive: true });
    const port = 55432;
    embedded = new EmbeddedPostgres({
      databaseDir: resolve("work", `pg-${process.pid}-${Date.now()}`),
      port,
      user: "postgres",
      password: "local-test-only",
      persistent: true,
      authMethod: "scram-sha-256",
      postgresFlags: ["-h", "127.0.0.1"],
      onLog: () => {},
      onError: () => {},
    });
    await embedded.initialise();
    await embedded.start();
    url = `postgres://postgres:local-test-only@127.0.0.1:${port}/postgres`;
  }
  if (embedded && process.platform === "win32") {
    const directory = embedded.options.databaseDir;
    embedded.stop = async () => {
      if (!embedded.process) return;
      await promisify(execFile)(
        resolve(
          "node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe",
        ),
        ["-D", directory, "stop", "-m", "fast", "-w"],
        { windowsHide: true },
      );
      embedded.process = undefined;
    };
  }
  const pool = database(url);
  await migrate(pool);
  return {
    pool,
    url,
    stop: async () => {
      await pool.end();
      if (embedded) await embedded.stop();
    },
  };
}
