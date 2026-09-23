import { readFile } from "node:fs/promises";
import { transaction } from "./db.js";
import {
  HttpError,
  check,
  string,
  integer,
  choice,
  fields,
  id,
  digest,
  hashPassword,
  verifyPassword,
  cookies,
  cookie,
  csrf,
  verifyMutation,
  readBody,
  sessionUser,
  newSession,
  rateLimit,
} from "./security.js";
import { createTrades, expireTrades, event } from "./trades.js";
import { enqueueAccountMail } from "./accounts.js";
const conditions = [
  "Near Mint",
  "Lightly Played",
  "Moderately Played",
  "Heavily Played",
  "Damaged",
];
export function createApp({
  pool,
  catalog,
  config,
  getPrices,
  logger = console.log,
  telemetry,
}) {
  const trades = createTrades(pool, catalog, getPrices),
    metrics = { requests: 0, errors: 0 };
  async function publicUser(db, u) {
    if (!u) return null;
    const items = (
      await db.query(
        "SELECT * FROM inventory WHERE user_id=$1 AND quantity>0 ORDER BY id",
        [u.id],
      )
    ).rows;
    return {
      id: u.id,
      email: u.email,
      nickname: u.nickname,
      verified: u.verified,
      storeIds: (
        await db.query("SELECT store_id FROM user_stores WHERE user_id=$1", [
          u.id,
        ])
      ).rows.map((s) => s.store_id),
      binder: items
        .filter((i) => i.kind === "binder")
        .map((i) => catalog.item(i)),
      collection: items
        .filter((i) => i.kind === "collection")
        .map((i) => catalog.item(i, true)),
      lookingFor: (
        await db.query("SELECT * FROM wants WHERE user_id=$1 ORDER BY id", [
          u.id,
        ])
      ).rows.map((w) => ({
        id: w.id,
        cardId: w.card_id,
        priority: w.priority,
        note: w.note,
        cardName: catalog.byId.get(w.card_id)?.name || "Unavailable card",
      })),
    };
  }
  return async (req, res) => {
    const requestId = id("req"),
      started = Date.now();
    metrics.requests++;
    const json = (status, body) => {
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(body));
    };
    res.setHeader("x-request-id", requestId);
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://cards.scryfall.io; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader("cache-control", "no-store");
    if (config.production)
      res.setHeader("strict-transport-security", "max-age=31536000");
    try {
      const url = new URL(req.url, config.origin),
        path = url.pathname,
        method = req.method;
      if (path === "/healthz") {
        json(200, { ok: true });
        return;
      }
      if (path === "/readyz") {
        const schema = await pool
          .query(
            "SELECT 1 FROM schema_migrations WHERE name='002-distributed-jobs.sql'",
          )
          .catch(() => {
            throw new HttpError(503, "Database unavailable");
          });
        check(schema.rowCount === 1, 503, "Schema unavailable");
        const age = (Date.now() - Date.parse(catalog.importedAt)) / 86400000;
        check(
          Number.isFinite(age) && age <= config.catalogMaxAgeDays,
          503,
          "Catalog refresh required",
        );
        json(200, { ok: true });
        return;
      }
      if (!path.startsWith("/api/")) {
        const asset = {
          "/": ["index.html", "text/html"],
          "/index.html": ["index.html", "text/html"],
          "/app.js": ["app.js", "text/javascript"],
          "/styles.css": ["styles.css", "text/css"],
        }[path];
        check(asset && ["GET", "HEAD"].includes(method), 404, "Not found");
        const file = await readFile(
          new URL(`../public/${asset[0]}`, import.meta.url),
        );
        res.writeHead(200, { "content-type": asset[1] + "; charset=utf-8" });
        res.end(method === "HEAD" ? undefined : file);
        return;
      }
      const ip = config.trustProxy
        ? String(req.headers["x-forwarded-for"] || req.socket.remoteAddress)
            .split(",")[0]
            .trim()
        : req.socket.remoteAddress;
      await rateLimit(pool, `ip:${ip}`, 240);
      if (
        ["/api/login", "/api/signup", "/api/account/reset-request"].includes(
          path,
        )
      )
        await rateLimit(pool, `auth:${ip}`, 20);
      let body = {};
      if (!["GET", "HEAD"].includes(method)) {
        verifyMutation(req, config);
        body = await readBody(req);
      }
      let user = await sessionUser(pool, req);
      const requireUser = () => {
        check(user, 401, "Login required");
        return user;
      };
      if (path === "/api/session" && method === "GET") {
        json(200, {
          user: await publicUser(pool, user),
          csrfToken: csrf(req, config),
          cards: catalog.cards.slice(0, 60).map((c) => catalog.publicCard(c)),
          stores: catalog.stores,
        });
        return;
      }
      if (path === "/api/cards" && method === "GET") {
        const query = url.searchParams.get("q") || "";
        string(query, "query", 0, 100);
        json(
          200,
          catalog.search(
            query,
            integer(
              Number(url.searchParams.get("limit") || 40),
              "limit",
              1,
              80,
            ),
            integer(
              Number(url.searchParams.get("offset") || 0),
              "offset",
              0,
              100000,
            ),
          ),
        );
        return;
      }
      if (path === "/api/signup" && method === "POST") {
        fields(body, ["email", "nickname", "password"]);
        const email = string(body.email, "email", 3, 254).trim().toLowerCase(),
          nickname = string(body.nickname, "nickname", 2, 24).trim();
        check(
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && nickname.length >= 2,
          400,
          "Invalid email or nickname",
        );
        const hash = await hashPassword(body.password);
        user = await transaction(pool, async (c) => {
          const u = (
            await c.query(
              "INSERT INTO users(id,email,nickname,password_hash) VALUES($1,$2,$3,$4) RETURNING *",
              [id("user"), email, nickname, hash],
            )
          ).rows[0];
          await enqueueAccountMail(c, u, "verify", config, requestId);
          await newSession(c, req, res, u.id, config.production);
          return u;
        });
        json(201, { user: await publicUser(pool, user) });
        return;
      }
      if (path === "/api/login" && method === "POST") {
        fields(body, ["email", "password"]);
        const email = string(body.email, "email", 1, 254).trim().toLowerCase();
        await rateLimit(pool, `account:${email}`, 10);
        const found = (
          await pool.query("SELECT * FROM users WHERE lower(email)=$1", [email])
        ).rows[0];
        const valid = await verifyPassword(body.password, found?.password_hash);
        check(
          valid && found && !found.disabled,
          401,
          "Email or password did not match",
        );
        await transaction(pool, (c) =>
          newSession(c, req, res, found.id, config.production),
        );
        json(200, { user: await publicUser(pool, found) });
        return;
      }
      if (path === "/api/logout" && method === "POST") {
        fields(body, []);
        const value = cookies(req).manabinder_session;
        if (value)
          await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
            digest(value),
          ]);
        cookie(res, "", config.production, true);
        json(200, { ok: true });
        return;
      }
      if (path === "/api/account/reset-request" && method === "POST") {
        fields(body, ["email"]);
        const email = string(body.email, "email", 3, 254).toLowerCase().trim();
        await transaction(pool, async (c) => {
          const u = (
            await c.query(
              "SELECT * FROM users WHERE lower(email)=$1 AND NOT disabled",
              [email],
            )
          ).rows[0];
          if (u) await enqueueAccountMail(c, u, "reset", config, requestId);
        });
        json(200, {
          ok: true,
          message: "If the account exists, a reset message will be delivered.",
        });
        return;
      }
      if (
        ["/api/account/verify", "/api/account/reset"].includes(path) &&
        method === "POST"
      ) {
        const purpose = path.endsWith("/verify") ? "verify" : "reset";
        fields(body, purpose === "verify" ? ["token"] : ["token", "password"]);
        const value = string(body.token, "token", 43, 43),
          hash = purpose === "reset" ? await hashPassword(body.password) : null;
        await transaction(pool, async (c) => {
          const t = (
            await c.query(
              "DELETE FROM account_tokens WHERE token_hash=$1 AND purpose=$2 AND expires_at>now() RETURNING user_id",
              [digest(value), purpose],
            )
          ).rows[0];
          check(t, 400, "Token invalid or expired");
          if (purpose === "verify")
            await c.query("UPDATE users SET verified=true WHERE id=$1", [
              t.user_id,
            ]);
          else {
            await c.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
              t.user_id,
              hash,
            ]);
            await c.query("DELETE FROM sessions WHERE user_id=$1", [t.user_id]);
            await c.query("DELETE FROM account_tokens WHERE user_id=$1", [
              t.user_id,
            ]);
          }
        });
        if (purpose === "reset") cookie(res, "", config.production, true);
        json(200, { ok: true });
        return;
      }
      if (path === "/api/account/verification-request" && method === "POST") {
        requireUser();
        fields(body, []);
        await rateLimit(pool, `verify:${user.id}`, 2);
        await transaction(pool, (c) =>
          enqueueAccountMail(c, user, "verify", config, requestId),
        );
        json(200, { ok: true });
        return;
      }
      if (path === "/api/account/password" && method === "POST") {
        requireUser();
        fields(body, ["currentPassword", "password"]);
        check(
          await verifyPassword(body.currentPassword, user.password_hash),
          403,
          "Password incorrect",
        );
        const hash = await hashPassword(body.password);
        await transaction(pool, async (c) => {
          await c.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
            user.id,
            hash,
          ]);
          await c.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
          await c.query("DELETE FROM account_tokens WHERE user_id=$1", [
            user.id,
          ]);
        });
        cookie(res, "", config.production, true);
        json(200, { ok: true });
        return;
      }
      if (path === "/api/account/export" && method === "GET") {
        requireUser();
        json(200, {
          user: await publicUser(pool, user),
          trades: (
            await pool.query(
              "SELECT id,status,created_at FROM trades WHERE from_user=$1 OR to_user=$1",
              [user.id],
            )
          ).rows,
          blocks: (
            await pool.query("SELECT target_id FROM blocks WHERE user_id=$1", [
              user.id,
            ])
          ).rows,
          reports: (
            await pool.query(
              "SELECT id,target_id,reason,status FROM reports WHERE user_id=$1",
              [user.id],
            )
          ).rows,
        });
        return;
      }
      if (path === "/api/account" && method === "DELETE") {
        requireUser();
        fields(body, ["password"]);
        check(
          await verifyPassword(body.password, user.password_hash),
          403,
          "Password incorrect",
        );
        await transaction(pool, async (c) => {
          await c.query("DELETE FROM trades WHERE from_user=$1 OR to_user=$1", [
            user.id,
          ]);
          await c.query("DELETE FROM users WHERE id=$1", [user.id]);
        });
        cookie(res, "", config.production, true);
        json(200, { ok: true });
        return;
      }
      if (path === "/api/me/stores" && method === "PATCH") {
        requireUser();
        fields(body, ["storeIds"]);
        check(
          Array.isArray(body.storeIds) &&
            body.storeIds.length <= 100 &&
            new Set(body.storeIds).size === body.storeIds.length &&
            body.storeIds.every((s) => catalog.storeIds.has(s)),
          400,
          "Invalid stores",
        );
        await transaction(pool, async (c) => {
          await c.query("DELETE FROM user_stores WHERE user_id=$1", [user.id]);
          for (const sid of body.storeIds)
            await c.query(
              "INSERT INTO user_stores(user_id,store_id) VALUES($1,$2)",
              [user.id, sid],
            );
        });
        json(200, { user: await publicUser(pool, user) });
        return;
      }
      if (
        ["/api/me/binder", "/api/me/collection"].includes(path) &&
        method === "POST"
      ) {
        requireUser();
        fields(body, [
          "cardId",
          "printingId",
          "finish",
          "condition",
          "quantity",
          "note",
          "location",
        ]);
        const kind = path.endsWith("/binder") ? "binder" : "collection";
        const p = catalog.printings.get(body.printingId);
        check(p && p.cardId === body.cardId, 400, "Invalid card printing");
        const finish = choice(body.finish, p.finishes, "finish"),
          condition = choice(body.condition, conditions, "condition"),
          quantity = integer(body.quantity ?? 1, "quantity", 1, 99),
          note = string(body.note ?? "", "note", 0, 80),
          location = string(body.location ?? "", "location", 0, 60);
        await transaction(pool, async (c) => {
          check(
            Number(
              (
                await c.query(
                  "SELECT count(*) AS n FROM inventory WHERE user_id=$1 AND quantity>0",
                  [user.id],
                )
              ).rows[0].n,
            ) < 1000,
            409,
            "Inventory limit reached",
          );
          await c.query(
            "INSERT INTO inventory(id,user_id,kind,card_id,printing_id,finish,condition,quantity,note,location) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            [
              id("item"),
              user.id,
              kind,
              body.cardId,
              p.id,
              finish,
              condition,
              quantity,
              note,
              location,
            ],
          );
        });
        json(201, { user: await publicUser(pool, user) });
        return;
      }
      const remove = path.match(/^\/api\/me\/(binder|collection)\/([^/]+)$/);
      if (remove && method === "DELETE") {
        requireUser();
        fields(body, []);
        await transaction(pool, async (c) => {
          await expireTrades(c);
          check(
            !(
              await c.query(
                "SELECT 1 FROM trade_items ti JOIN trades t ON t.id=ti.trade_id WHERE ti.item_id=$1 AND t.status='accepted' AND t.expires_at>now()",
                [remove[2]],
              )
            ).rowCount,
            409,
            "Item reserved for a trade",
          );
          check(
            (
              await c.query(
                "UPDATE inventory SET quantity=0 WHERE id=$1 AND user_id=$2 AND kind=$3",
                [remove[2], user.id, remove[1]],
              )
            ).rowCount,
            404,
            "Item not found",
          );
        });
        json(200, { user: await publicUser(pool, user) });
        return;
      }
      if (path === "/api/me/looking-for" && method === "POST") {
        requireUser();
        fields(body, ["cardId", "priority", "note"]);
        check(catalog.byId.has(body.cardId), 400, "Invalid card");
        choice(body.priority, ["Low", "Normal", "High"], "priority");
        string(body.note ?? "", "note", 0, 80);
        await transaction(pool, async (c) => {
          check(
            Number(
              (
                await c.query(
                  "SELECT count(*) AS n FROM wants WHERE user_id=$1",
                  [user.id],
                )
              ).rows[0].n,
            ) < 1000,
            409,
            "Wanted list limit reached",
          );
          await c.query(
            "INSERT INTO wants(id,user_id,card_id,priority,note) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,card_id) DO UPDATE SET priority=$4,note=$5",
            [id("want"), user.id, body.cardId, body.priority, body.note || ""],
          );
        });
        json(201, { user: await publicUser(pool, user) });
        return;
      }
      if (path.startsWith("/api/me/looking-for/") && method === "DELETE") {
        requireUser();
        fields(body, []);
        check(
          (
            await pool.query("DELETE FROM wants WHERE id=$1 AND user_id=$2", [
              path.split("/").pop(),
              user.id,
            ])
          ).rowCount,
          404,
          "Wanted card not found",
        );
        json(200, { user: await publicUser(pool, user) });
        return;
      }
      if (path === "/api/binders" && method === "GET") {
        const wanted = url.searchParams.get("wantedByUserId");
        if (wanted) {
          requireUser();
          check(wanted === user.id, 403, "Private wanted list");
        }
        const limit = integer(
            Number(url.searchParams.get("limit") || 20),
            "limit",
            1,
            40,
          ),
          offset = integer(
            Number(url.searchParams.get("offset") || 0),
            "offset",
            0,
            100000,
          ),
          store = url.searchParams.get("storeId");
        const owners = (
          await pool.query(
            `SELECT u.id,u.nickname FROM users u WHERE NOT u.disabled
     AND EXISTS(SELECT 1 FROM inventory i WHERE i.user_id=u.id AND i.kind='binder' AND i.quantity>0)
     AND ($1::text IS NULL OR EXISTS(SELECT 1 FROM user_stores s WHERE s.user_id=u.id AND s.store_id=$1))
     AND ($2::text IS NULL OR NOT EXISTS(SELECT 1 FROM wants WHERE user_id=$2) OR EXISTS(SELECT 1 FROM inventory i JOIN wants w ON w.card_id=i.card_id WHERE w.user_id=$2 AND i.user_id=u.id AND i.kind='binder' AND i.quantity>0))
     AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=$3 AND b.target_id=u.id) OR (b.target_id=$3 AND b.user_id=u.id)) ORDER BY u.id LIMIT $4 OFFSET $5`,
            [store, wanted, user?.id || null, limit + 1, offset],
          )
        ).rows;
        const wantIds = new Set(
            wanted
              ? (
                  await pool.query(
                    "SELECT card_id FROM wants WHERE user_id=$1",
                    [user.id],
                  )
                ).rows.map((w) => w.card_id)
              : [],
          ),
          binders = [];
        const selectedOwners = owners.slice(0, limit),
          ownerIds = selectedOwners.map((u) => u.id);
        const [storeRows, itemRows] = await Promise.all([
          pool.query(
            "SELECT user_id,store_id FROM user_stores WHERE user_id=ANY($1::text[])",
            [ownerIds],
          ),
          pool.query(
            "SELECT i.* FROM unnest($1::text[]) AS owners(user_id) CROSS JOIN LATERAL (SELECT * FROM inventory WHERE user_id=owners.user_id AND kind='binder' AND quantity>0 ORDER BY id LIMIT 1000) i",
            [ownerIds],
          ),
        ]);
        const storesByUser = new Map(ownerIds.map((id) => [id, new Set()])),
          itemsByUser = new Map(ownerIds.map((id) => [id, []]));
        for (const row of storeRows.rows)
          storesByUser.get(row.user_id).add(row.store_id);
        for (const row of itemRows.rows) itemsByUser.get(row.user_id).push(row);
        for (const u of selectedOwners)
          binders.push({
            ...u,
            stores: catalog.stores.filter((store) =>
              storesByUser.get(u.id).has(store.id),
            ),
            binder: itemsByUser
              .get(u.id)
              .map((i) => ({
                ...catalog.item(i),
                wantedMatch: wantIds.has(i.card_id),
              })),
          });
        json(200, {
          binders,
          nextOffset: owners.length > limit ? offset + limit : null,
        });
        return;
      }
      if (
        ["/api/trades/quote", "/api/trades"].includes(path) &&
        method === "POST"
      ) {
        requireUser();
        await rateLimit(pool, `trade:${user.id}`, 20);
        if (path.endsWith("/quote")) {
          json(200, await trades.quote(user, body));
          return;
        }
        json(
          201,
          await trades.send(user, body, req.headers["idempotency-key"]),
        );
        return;
      }
      if (path === "/api/trades" && method === "GET") {
        requireUser();
        const before = url.searchParams.get("before") || "9999-01-01";
        check(Number.isFinite(Date.parse(before)), 400, "Invalid cursor");
        const result = (
          await pool.query(
            "SELECT id,from_user,to_user,status,confirmed_from,confirmed_to,created_at,expires_at FROM trades WHERE (from_user=$1 OR to_user=$1) AND created_at<$2 ORDER BY created_at DESC LIMIT 50",
            [user.id, before],
          )
        ).rows;
        json(200, {
          trades: result,
          nextBefore: result.length === 50 ? result.at(-1).created_at : null,
        });
        return;
      }
      const tradePath = path.match(
        /^\/api\/trades\/([^/]+)(?:\/(accept|decline|cancel|complete))?$/,
      );
      if (tradePath) {
        requireUser();
        if (method === "POST" && tradePath[2]) {
          fields(body, []);
          json(200, await trades.transition(user, tradePath[1], tradePath[2]));
          return;
        }
        if (method === "GET" && !tradePath[2]) {
          const t = (
            await pool.query(
              "SELECT id,from_user,to_user,status,confirmed_from,confirmed_to,created_at,expires_at FROM trades WHERE id=$1 AND (from_user=$2 OR to_user=$2)",
              [tradePath[1], user.id],
            )
          ).rows[0];
          check(t, 404, "Trade not found");
          json(200, {
            trade: t,
            items: (
              await pool.query(
                "SELECT owner_id,quantity,snapshot FROM trade_items WHERE trade_id=$1",
                [t.id],
              )
            ).rows,
            events: (
              await pool.query(
                "SELECT event,created_at FROM trade_events WHERE trade_id=$1 ORDER BY id",
                [t.id],
              )
            ).rows,
          });
          return;
        }
      }
      if (path === "/api/notifications" && method === "GET") {
        requireUser();
        json(200, {
          notifications: (
            await pool.query(
              "SELECT id,trade_id,message,is_read,created_at FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 100",
              [user.id],
            )
          ).rows,
        });
        return;
      }
      if (path === "/api/notifications/read" && method === "POST") {
        requireUser();
        fields(body, []);
        await pool.query(
          "UPDATE notifications SET is_read=true WHERE user_id=$1",
          [user.id],
        );
        json(200, { ok: true });
        return;
      }
      if (path === "/api/blocks" && ["POST", "DELETE"].includes(method)) {
        requireUser();
        fields(body, ["targetId"]);
        string(body.targetId, "target", 1, 100);
        check(body.targetId !== user.id, 400, "Cannot block yourself");
        await transaction(pool, async (c) => {
          check(
            (await c.query("SELECT 1 FROM users WHERE id=$1", [body.targetId]))
              .rowCount,
            404,
            "User not found",
          );
          if (method === "DELETE")
            await c.query(
              "DELETE FROM blocks WHERE user_id=$1 AND target_id=$2",
              [user.id, body.targetId],
            );
          else {
            await c.query(
              "INSERT INTO blocks(user_id,target_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
              [user.id, body.targetId],
            );
            const r = await c.query(
              "UPDATE trades SET status='cancelled' WHERE status IN ('pending','accepted') AND ((from_user=$1 AND to_user=$2) OR (from_user=$2 AND to_user=$1)) RETURNING *",
              [user.id, body.targetId],
            );
            for (const t of r.rows) await event(c, t, user.id, "cancelled");
          }
        });
        json(200, { ok: true });
        return;
      }
      if (path === "/api/reports" && method === "POST") {
        requireUser();
        fields(body, ["targetId", "reason"]);
        string(body.targetId, "target", 1, 100);
        string(body.reason, "reason", 1, 1000);
        await rateLimit(pool, `report:${user.id}`, 5);
        check(
          (await pool.query("SELECT 1 FROM users WHERE id=$1", [body.targetId]))
            .rowCount,
          404,
          "User not found",
        );
        await pool.query(
          "INSERT INTO reports(user_id,target_id,reason) VALUES($1,$2,$3)",
          [user.id, body.targetId, body.reason],
        );
        json(201, { ok: true });
        return;
      }
      if (path.startsWith("/api/admin/")) {
        requireUser();
        check(config.adminIds.includes(user.id), 403, "Administrator required");
        if (path === "/api/admin/metrics" && method === "GET") {
          json(200, {
            ...metrics,
            memoryBytes: process.memoryUsage().rss,
            failedMail: Number(
              (
                await pool.query(
                  "SELECT count(*) AS n FROM mail_outbox WHERE status='failed'",
                )
              ).rows[0].n,
            ),
          });
          return;
        }
        if (path === "/api/admin/reports" && method === "GET") {
          json(200, {
            reports: (
              await pool.query(
                "SELECT * FROM reports WHERE status='open' ORDER BY id LIMIT 100",
              )
            ).rows,
          });
          return;
        }
        if (path === "/api/admin/moderate" && method === "POST") {
          fields(body, ["targetId", "action", "reportId"]);
          choice(body.action, ["disable", "enable", "resolve"], "action");
          string(body.targetId, "target", 1, 100);
          if (body.reportId)
            integer(Number(body.reportId), "report ID", 1, 1e9);
          await transaction(pool, async (c) => {
            if (body.action !== "resolve") {
              check(
                (
                  await c.query("UPDATE users SET disabled=$2 WHERE id=$1", [
                    body.targetId,
                    body.action === "disable",
                  ])
                ).rowCount,
                404,
                "User not found",
              );
              await c.query("DELETE FROM sessions WHERE user_id=$1", [
                body.targetId,
              ]);
              const affected = await c.query(
                "UPDATE trades SET status='cancelled' WHERE (from_user=$1 OR to_user=$1) AND status IN ('pending','accepted') RETURNING *",
                [body.targetId],
              );
              for (const t of affected.rows)
                await event(c, t, user.id, "cancelled");
            }
            if (body.reportId)
              await c.query(
                "UPDATE reports SET status='resolved' WHERE id=$1",
                [body.reportId],
              );
            await c.query(
              "INSERT INTO moderation_events(actor_id,target_id,action) VALUES($1,$2,$3)",
              [user.id, body.targetId, body.action],
            );
          });
          json(200, { ok: true });
          return;
        }
      }
      throw new HttpError(404, "Not found");
    } catch (error) {
      metrics.errors++;
      let status = error.status || 500;
      if (["23505", "23503", "40001", "40P01", "55P03"].includes(error.code))
        status = 409;
      if (status === 429) res.setHeader("retry-after", "60");
      json(status, {
        error:
          status === 500
            ? "Server error"
            : error.code === "23505"
              ? "Account or item already exists"
              : ["23503", "40001", "40P01", "55P03"].includes(error.code)
                ? "Data changed concurrently; retry the operation"
                : error.message,
        requestId,
      });
    } finally {
      telemetry?.observe(req, res.statusCode, (Date.now() - started) / 1000);
      logger(
        JSON.stringify({
          event: "request",
          requestId,
          method: req.method,
          status: res.statusCode,
          durationMs: Date.now() - started,
        }),
      );
    }
  };
}
