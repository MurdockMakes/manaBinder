import { check, HttpError } from "./security.js";
const factors = {
  "Near Mint": 100,
  "Lightly Played": 90,
  "Moderately Played": 78,
  "Heavily Played": 62,
  Damaged: 45,
};
export function cents(value) {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) return null;
  const n = Number(value.replace(".", ""));
  return Number.isSafeInteger(n) ? n : null;
}
export function valuation(items, prices) {
  let total = 0;
  for (const item of items) {
    const price = prices.get(`${item.printing_id}:${item.finish}`);
    if (price === null || price === undefined) return null;
    check(
      Number.isSafeInteger(price) && price >= 0 && factors[item.condition],
      400,
      "Invalid valuation",
    );
    total +=
      Math.round((price * factors[item.condition]) / 100) *
      item.selectedQuantity;
  }
  check(Number.isSafeInteger(total), 400, "Value too large");
  return total;
}
export function fairness(requested, offered, prices) {
  const a = valuation(requested, prices),
    b = valuation(offered, prices);
  if (a === null || b === null)
    return {
      state: "unavailable",
      message: "Exact-finish prices unavailable. Try later.",
    };
  const tolerance = Math.max(75, Math.round((a * 4) / 100));
  return Math.abs(b - a) <= tolerance
    ? { state: "even", message: "About even. Ready to send." }
    : b < a
      ? { state: "low", message: "Add more to your offer." }
      : { state: "high", message: "Remove from your offer." };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function priceProvider(
  pool,
  config,
  { fetcher = fetch, wait = sleep } = {},
) {
  return async (items) => {
    const ids = [...new Set(items.map((x) => x.printing_id))];
    const prices = new Map();
    for (let offset = 0; offset < ids.length; offset += 75) {
      let payload;
      for (let attempt = 0; attempt < 3; attempt++) {
        const slot = await pool.query(
          `INSERT INTO provider_slots(name,next_at) VALUES('scryfall',now()+interval '600 milliseconds') ON CONFLICT(name) DO UPDATE SET next_at=GREATEST(provider_slots.next_at,now())+interval '600 milliseconds' RETURNING EXTRACT(EPOCH FROM (next_at-now()))*1000 AS delay`,
        );
        check(
          Number(slot.rows[0].delay) <= 10000,
          503,
          "Price provider queue full; retry later",
        );
        await wait(Math.max(0, Number(slot.rows[0].delay) - 600));
        let response;
        try {
          response = await fetcher(
            "https://api.scryfall.com/cards/collection",
            {
              method: "POST",
              headers: {
                accept: "application/json",
                "content-type": "application/json",
                "user-agent": config.userAgent,
              },
              body: JSON.stringify({
                identifiers: ids
                  .slice(offset, offset + 75)
                  .map((id) => ({ id })),
              }),
              signal: AbortSignal.timeout(8000),
            },
          );
        } catch {
          if (attempt < 2) {
            await wait(500 * 2 ** attempt);
            continue;
          }
          throw new HttpError(503, "Price provider unavailable");
        }
        if (response.ok) {
          try {
            payload = await response.json();
          } catch {
            throw new HttpError(503, "Invalid price response");
          }
          break;
        }
        if (response.status !== 429 && response.status < 500)
          throw new HttpError(503, "Price lookup rejected");
        const hint = response.headers.get("retry-after");
        const delay = hint
          ? Number.isFinite(Number(hint))
            ? Number(hint) * 1000
            : Date.parse(hint) - Date.now()
          : 500 * 2 ** attempt;
        if (delay > 10000 || attempt === 2)
          throw new HttpError(503, "Price provider busy; retry later");
        await wait(Math.max(0, delay));
      }
      check(Array.isArray(payload?.data), 503, "Invalid price response");
      for (const card of payload.data)
        for (const [finish, key] of Object.entries({
          nonfoil: "usd",
          foil: "usd_foil",
          etched: "usd_etched",
        }))
          prices.set(`${card.id}:${finish}`, cents(card.prices?.[key]));
    }
    return prices;
  };
}
