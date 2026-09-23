import { randomBytes } from "node:crypto";
export function config(env = process.env) {
  const production = env.NODE_ENV === "production";
  const origin = env.APP_ORIGIN || "http://127.0.0.1:4174";
  const secret =
    env.SESSION_SECRET || (!production ? randomBytes(32).toString("hex") : "");
  if (
    production &&
    (secret.length < 43 || /dev-only|replace|example/i.test(secret))
  )
    throw Error("Strong SESSION_SECRET required");
  const url = new URL(origin);
  if (url.origin !== origin || (production && url.protocol !== "https:"))
    throw Error("APP_ORIGIN must be an exact HTTPS origin in production");
  if (!env.DATABASE_URL)
    throw Error("DATABASE_URL required; JSON storage is no longer supported");
  const mailMode = env.MAIL_MODE || "file";
  if (
    !["file", "webhook"].includes(mailMode) ||
    (production && mailMode !== "webhook")
  )
    throw Error("Production requires MAIL_MODE=webhook");
  if (
    mailMode === "webhook" &&
    (!env.MAIL_TOKEN || !env.MAIL_WEBHOOK?.startsWith("https://"))
  )
    throw Error("HTTPS mail webhook and token required");
  if (
    production &&
    (!env.SCRYFALL_USER_AGENT ||
      /local-development|replace@example/i.test(env.SCRYFALL_USER_AGENT))
  )
    throw Error("Real Scryfall contact required");
  return {
    production,
    origin,
    secret,
    port: Number(env.PORT || 4174),
    host: env.HOST || "127.0.0.1",
    databaseUrl: env.DATABASE_URL,
    trustProxy: env.TRUST_PROXY === "true",
    mailMode,
    mailDir: env.MAIL_DIR || "work/mail",
    mailWebhook: env.MAIL_WEBHOOK,
    mailToken: env.MAIL_TOKEN,
    userAgent: env.SCRYFALL_USER_AGENT || "ManaBinder/0.2 local-development",
    adminIds: (env.ADMIN_IDS || "").split(",").filter(Boolean),
    catalogMaxAgeDays: Number(env.CATALOG_MAX_AGE_DAYS || 180),
  };
}
