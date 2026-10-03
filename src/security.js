import {
  randomBytes,
  createHash,
  createHmac,
  scrypt as derive,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(derive);
export const id = (prefix) => `${prefix}_${randomBytes(16).toString("hex")}`;
export const token = () => randomBytes(32).toString("base64url");
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function check(value, status, message) {
  if (!value) throw new HttpError(status, message);
}
export function string(value, name, min = 0, max = 100) {
  check(
    typeof value === "string" && value.length >= min && value.length <= max,
    400,
    `Invalid ${name}`,
  );
  return value;
}
export function integer(value, name, min = 1, max = 999) {
  check(
    Number.isSafeInteger(value) && value >= min && value <= max,
    400,
    `Invalid ${name}`,
  );
  return value;
}
export function choice(value, values, name) {
  check(values.includes(value), 400, `Invalid ${name}`);
  return value;
}
export function fields(body, allowed) {
  check(
    body && typeof body === "object" && !Array.isArray(body),
    400,
    "Expected JSON object",
  );
  check(
    Object.keys(body).every((k) => allowed.includes(k)),
    400,
    "Unknown field",
  );
  return body;
}
export async function hashPassword(password) {
  string(password, "password", 10, 256);
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${(await scrypt(password, salt, 64)).toString("hex")}`;
}
export async function verifyPassword(password, stored) {
  string(password, "password", 1, 256);
  const [, salt, hex] = String(stored).split(":");
  if (!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored || "")) {
    await scrypt(password, "missing-account", 64);
    return false;
  }
  return timingSafeEqual(
    Buffer.from(hex, "hex"),
    await scrypt(password, salt, 64),
  );
}
export function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((p) => p.trim().split("="))
      .filter((p) => p.length === 2),
  );
}
export function cookie(res, value, production, clear = false) {
  res.setHeader(
    "set-cookie",
    `manabinder_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${clear ? 0 : 604800}${production ? "; Secure" : ""}`,
  );
}
export function csrf(req, config) {
  const session = cookies(req).manabinder_session || "anonymous";
  return createHmac("sha256", config.secret)
    .update(session)
    .digest("base64url");
}
export function verifyMutation(req, config) {
  check(req.headers.origin === config.origin, 403, "Origin rejected");
  const supplied = req.headers["x-csrf-token"];
  const expected = csrf(req, config);
  check(
    typeof supplied === "string" &&
      Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)),
    403,
    "CSRF token required",
  );
  check(
    req.headers["content-type"]?.split(";")[0].trim() === "application/json",
    415,
    "Use application/json",
  );
}
export async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    check(size <= 32768, 413, "Body too large");
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    check(
      body && typeof body === "object" && !Array.isArray(body),
      400,
      "Expected JSON object",
    );
    return body;
  } catch (error) {
    if (error.status) throw error;
    throw new HttpError(400, "Malformed JSON");
  }
}
export async function sessionUser(db, req) {
  const value = cookies(req).manabinder_session;
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  return (
    (
      await db.query(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now() AND NOT disabled",
        [digest(value)],
      )
    ).rows[0] || null
  );
}
export async function newSession(db, req, res, userId, production) {
  const old = cookies(req).manabinder_session;
  if (old)
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [digest(old)]);
  const value = token();
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [digest(value), userId],
  );
  cookie(res, value, production);
}
export async function rateLimit(db, key, limit = 120) {
  const hash = digest(key);
  const r = await db.query(
    `INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+interval '1 minute')
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END,
 expires_at=CASE WHEN rate_limits.expires_at<now() THEN now()+interval '1 minute' ELSE rate_limits.expires_at END RETURNING count`,
    [hash],
  );
  check(r.rows[0].count <= limit, 429, "Too many requests; retry in a minute");
}
export function seal(message, secret) {
  const iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(digest(secret), "hex"),
      iv,
    );
  return Buffer.concat([
    iv,
    cipher.update(JSON.stringify(message)),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}
export function unseal(value, secret) {
  const b = Buffer.from(value, "base64"),
    d = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(digest(secret), "hex"),
      b.subarray(0, 12),
    );
  d.setAuthTag(b.subarray(-16));
  return JSON.parse(
    Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString(),
  );
}
