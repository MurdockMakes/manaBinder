import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
const env = {
  ...process.env,
  POSTGRES_PASSWORD: randomBytes(24).toString("hex"),
  RABBITMQ_PASSWORD: randomBytes(24).toString("hex"),
  SESSION_SECRET: randomBytes(32).toString("hex"),
  GRAFANA_PASSWORD: randomBytes(24).toString("hex"),
};
const compose = (args) =>
  execFileSync(
    "docker",
    [
      "compose",
      "-p",
      "manabinder-smoke",
      "-f",
      "compose.services.yaml",
      ...args,
    ],
    { env, stdio: "inherit" },
  );
try {
  compose(["up", "--build", "-d", "--wait", "--wait-timeout", "180"]);
  for (const path of ["/readyz", "/api/session", "/"]) {
    const r = await fetch("http://127.0.0.1:8080" + path);
    if (!r.ok) throw Error("Stack smoke failed " + path + ": " + r.status);
  }
  const session = await (
    await fetch("http://127.0.0.1:8080/api/session")
  ).json();
  const response = await fetch("http://127.0.0.1:8080/api/signup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:8080",
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({
      email: "smoke@example.test",
      nickname: "Container smoke",
      password: randomBytes(16).toString("hex"),
    }),
  });
  if (response.status !== 201) throw Error("Container signup failed");
  let sent = false;
  for (let i = 0; i < 40; i++) {
    try {
      const output = execFileSync(
        "docker",
        [
          "compose",
          "-p",
          "manabinder-smoke",
          "-f",
          "compose.services.yaml",
          "exec",
          "-T",
          "db",
          "psql",
          "-U",
          "manabinder",
          "-At",
          "-c",
          "SELECT count(*) FROM mail_outbox WHERE status='sent'",
        ],
        { env },
      )
        .toString()
        .trim();
      if (Number(output) >= 1) {
        sent = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!sent) throw Error("Outbox -> RabbitMQ -> worker did not deliver");
  console.log("Container stack and real broker mail pipeline passed");
} finally {
  compose(["down", "--volumes"]);
}
