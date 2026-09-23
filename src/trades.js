import { check, fields, string, integer, id, digest } from "./security.js";
import { transaction } from "./db.js";
import { fairness } from "./pricing.js";
export async function expireTrades(db) {
  const r = await db.query(
    "UPDATE trades SET status='expired' WHERE status IN ('pending','accepted') AND expires_at<now() RETURNING id,from_user,to_user",
  );
  for (const t of r.rows) await event(db, t, null, "expired");
}
export async function event(db, t, actor, event) {
  await db.query(
    "INSERT INTO trade_events(trade_id,actor_id,event) VALUES($1,$2,$3)",
    [t.id, actor, event],
  );
  for (const uid of [t.from_user, t.to_user])
    await db.query(
      "INSERT INTO notifications(user_id,trade_id,message) VALUES($1,$2,$3)",
      [uid, t.id, `Trade ${event}`],
    );
}
export async function selections(db, user, body, catalog) {
  fields(body, [
    "toUserId",
    "targetUserId",
    "requestedItems",
    "offeredItems",
    "requestedItemIds",
    "offeredItemIds",
  ]);
  const target = string(body.toUserId || body.targetUserId, "target", 1, 100);
  const sender = (
    await db.query("SELECT verified FROM users WHERE id=$1 AND NOT disabled", [
      user.id,
    ])
  ).rows[0];
  check(sender?.verified, 403, "Verified active account required");
  check(target !== user.id, 400, "Choose another user");
  const other = (
    await db.query(
      "SELECT id,verified FROM users WHERE id=$1 AND NOT disabled",
      [target],
    )
  ).rows[0];
  check(other, 404, "Binder unavailable");
  check(
    user.verified && other.verified,
    403,
    "Both accounts must verify their email",
  );
  check(
    !(
      await db.query(
        "SELECT 1 FROM blocks WHERE (user_id=$1 AND target_id=$2) OR (user_id=$2 AND target_id=$1)",
        [user.id, target],
      )
    ).rowCount,
    403,
    "Trading unavailable",
  );
  const resolve = async (side, owner, publicOnly) => {
    const entries =
      body[`${side}Items`] ||
      body[`${side}ItemIds`]?.map((id) => ({ id, quantity: 1 }));
    check(
      Array.isArray(entries) && entries.length > 0 && entries.length <= 150,
      400,
      "Select 1–150 items on each side",
    );
    const seen = new Set(),
      items = [];
    for (const entry of entries) {
      fields(entry, ["id", "quantity"]);
      string(entry.id, "item", 1, 100);
      integer(entry.quantity, "quantity");
      check(!seen.has(entry.id), 400, "Duplicate item");
      seen.add(entry.id);
      const i = (
        await db.query("SELECT * FROM inventory WHERE id=$1 AND user_id=$2", [
          entry.id,
          owner,
        ])
      ).rows[0];
      check(
        i && (!publicOnly || i.kind === "binder"),
        409,
        "Selected item unavailable",
      );
      check(
        catalog.printings.get(i.printing_id)?.finishes.includes(i.finish),
        409,
        "Printing/finish unavailable",
      );
      const reserved = Number(
        (
          await db.query(
            "SELECT COALESCE(sum(ti.quantity),0) AS n FROM trade_items ti JOIN trades t ON ti.trade_id=t.id WHERE ti.item_id=$1 AND t.status='accepted' AND t.expires_at>now()",
            [i.id],
          )
        ).rows[0].n,
      );
      check(
        i.quantity - reserved >= entry.quantity,
        409,
        "Insufficient available quantity",
      );
      items.push({ ...i, selectedQuantity: entry.quantity });
    }
    return items;
  };
  return {
    target,
    requested: await resolve("requested", target, true),
    offered: await resolve("offered", user.id, false),
  };
}
export function createTrades(pool, catalog, getPrices) {
  return {
    async quote(user, body) {
      const s = await selections(pool, user, body, catalog);
      return fairness(
        s.requested,
        s.offered,
        await getPrices([...s.requested, ...s.offered]),
      );
    },
    async send(user, body, key) {
      string(key, "Idempotency-Key", 8, 100);
      const requestHash = digest(JSON.stringify(body));
      const existing = (
        await pool.query(
          "SELECT id,request_hash FROM trades WHERE from_user=$1 AND idempotency_key=$2",
          [user.id, key],
        )
      ).rows[0];
      if (existing) {
        check(
          existing.request_hash === requestHash,
          409,
          "Idempotency key reused with different request",
        );
        return {
          id: existing.id,
          quote: { state: "even", message: "Request already sent." },
        };
      }
      const s = await selections(pool, user, body, catalog),
        prices = await getPrices([...s.requested, ...s.offered]);
      const quote = fairness(s.requested, s.offered, prices);
      check(quote.state === "even", 409, quote.message);
      return transaction(pool, async (c) => {
        await expireTrades(c);
        const repeated = (
          await c.query(
            "SELECT id,request_hash FROM trades WHERE from_user=$1 AND idempotency_key=$2",
            [user.id, key],
          )
        ).rows[0];
        if (repeated) {
          check(
            repeated.request_hash === requestHash,
            409,
            "Idempotency key reused",
          );
          return { id: repeated.id, quote };
        }
        const current = await selections(c, user, body, catalog);
        check(
          JSON.stringify(current) === JSON.stringify(s),
          409,
          "Inventory changed; quote again",
        );
        const tradeId = id("trade");
        const audit = {
          at: new Date().toISOString(),
          source: "Scryfall",
          prices: Object.fromEntries(prices),
        };
        const t = (
          await c.query(
            "INSERT INTO trades(id,from_user,to_user,status,idempotency_key,request_hash,quote) VALUES($1,$2,$3,'pending',$4,$5,$6) RETURNING *",
            [tradeId, user.id, s.target, key, requestHash, audit],
          )
        ).rows[0];
        for (const item of [...s.requested, ...s.offered])
          await c.query(
            "INSERT INTO trade_items(trade_id,item_id,owner_id,quantity,snapshot) VALUES($1,$2,$3,$4,$5)",
            [
              tradeId,
              item.id,
              item.user_id,
              item.selectedQuantity,
              catalog.item(item),
            ],
          );
        await event(c, t, user.id, "pending");
        return { id: tradeId, quote };
      });
    },
    async transition(user, tradeId, action) {
      check(
        ["accept", "decline", "cancel", "complete"].includes(action),
        400,
        "Invalid action",
      );
      return transaction(pool, async (c) => {
        await expireTrades(c);
        const t = (
          await c.query(
            "SELECT * FROM trades WHERE id=$1 AND (from_user=$2 OR to_user=$2) FOR UPDATE",
            [tradeId, user.id],
          )
        ).rows[0];
        check(t, 404, "Trade not found");
        const next = {
          accept: "accepted",
          decline: "declined",
          cancel: "cancelled",
          complete: "completed",
        }[action];
        if (action === "accept" || action === "decline")
          check(t.to_user === user.id, 403, "Recipient only");
        if (t.status === next) return { status: t.status };
        if (action === "complete") {
          check(
            t.status === "accepted",
            409,
            "Only accepted trades can complete",
          );
          const column =
            t.from_user === user.id ? "confirmed_from" : "confirmed_to";
          if (t[column]) return { status: "accepted" };
          await c.query(`UPDATE trades SET ${column}=true WHERE id=$1`, [
            tradeId,
          ]);
          t[column] = true;
          if (!t.confirmed_from || !t.confirmed_to) {
            await event(c, t, user.id, "handoff confirmed");
            return { status: "accepted" };
          }
          const items = (
            await c.query(
              "SELECT ti.*,i.card_id,i.printing_id,i.finish,i.condition FROM trade_items ti JOIN inventory i ON i.id=ti.item_id WHERE trade_id=$1",
              [tradeId],
            )
          ).rows;
          for (const i of items) {
            const updated = await c.query(
              "UPDATE inventory SET quantity=quantity-$2 WHERE id=$1 AND quantity>=$2",
              [i.item_id, i.quantity],
            );
            check(updated.rowCount === 1, 409, "Stock conflict");
            await c.query(
              "INSERT INTO inventory(id,user_id,kind,card_id,printing_id,finish,condition,quantity) VALUES($1,$2,'collection',$3,$4,$5,$6,$7)",
              [
                id("item"),
                i.owner_id === t.from_user ? t.to_user : t.from_user,
                i.card_id,
                i.printing_id,
                i.finish,
                i.condition,
                i.quantity,
              ],
            );
          }
        } else if (action === "accept") {
          check(t.status === "pending", 409, "Trade is no longer pending");
          const parties = (
            await c.query(
              "SELECT id FROM users WHERE id=ANY($1::text[]) AND verified AND NOT disabled",
              [[t.from_user, t.to_user]],
            )
          ).rows;
          check(parties.length === 2, 403, "Account unavailable");
          check(
            !(
              await c.query(
                "SELECT 1 FROM blocks WHERE (user_id=$1 AND target_id=$2) OR (user_id=$2 AND target_id=$1)",
                [t.from_user, t.to_user],
              )
            ).rowCount,
            403,
            "Trading unavailable",
          );
          const items = (
            await c.query("SELECT * FROM trade_items WHERE trade_id=$1", [
              tradeId,
            ])
          ).rows;
          for (const i of items) {
            const stock = (
              await c.query("SELECT quantity FROM inventory WHERE id=$1", [
                i.item_id,
              ])
            ).rows[0];
            const reserved = Number(
              (
                await c.query(
                  "SELECT COALESCE(sum(ti.quantity),0) AS n FROM trade_items ti JOIN trades t ON ti.trade_id=t.id WHERE ti.item_id=$1 AND t.status='accepted'",
                  [i.item_id],
                )
              ).rows[0].n,
            );
            check(
              stock && stock.quantity - reserved >= i.quantity,
              409,
              "Stock already committed",
            );
          }
        } else if (action === "decline")
          check(t.status === "pending", 409, "Trade is no longer pending");
        else
          check(
            ["pending", "accepted"].includes(t.status),
            409,
            "Trade is closed",
          );
        await c.query("UPDATE trades SET status=$2 WHERE id=$1", [
          tradeId,
          next,
        ]);
        await event(c, t, user.id, next);
        return { status: next };
      });
    },
  };
}
