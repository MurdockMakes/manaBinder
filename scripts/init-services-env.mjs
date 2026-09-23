import { writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const entries = [
  "POSTGRES_PASSWORD",
  "RABBITMQ_PASSWORD",
  "SESSION_SECRET",
  "GRAFANA_PASSWORD",
]
  .map((name) => `${name}=${randomBytes(32).toString("hex")}`)
  .join("\n");
await writeFile(".env.services", entries + "\n", { flag: "wx", mode: 0o600 });
console.log(
  "Created .env.services with local-only credentials; existing files are never overwritten.",
);
