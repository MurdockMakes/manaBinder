import { createServer } from "node:http";
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const PORT = Number(process.env.PORT || 4174);
const DATA_DIR = new URL("./data/", import.meta.url);
const PUBLIC_DIR = new URL("./public/", import.meta.url);
const DB_FILE = new URL("./data/db.json", import.meta.url);
const STORES_FILE = new URL("./data/stores.massachusetts.json", import.meta.url);
const CARDS_FILE = new URL("./data/cards.scryfall.json", import.meta.url);
const SESSION_COOKIE = "manabinder_session";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-change-me-before-production";
const SCRYFALL_COLLECTION_ENDPOINT = "https://api.scryfall.com/cards/collection";
const SCRYFALL_USER_AGENT = "ManaBinder/0.1 trade-price-check contact=local-development";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const legacyCards = [
  {
    id: "sol-ring",
    name: "Sol Ring",
    type: "Artifact",
    colors: ["colorless"],
    printings: [
      { id: "sol-ring-cmm-394", set: "Commander Masters", number: "394", treatment: "Regular", value: 1.85 },
      { id: "sol-ring-brc-155", set: "The Brothers' War Commander", number: "155", treatment: "Retro", value: 2.6 },
      { id: "sol-ring-ltc-400", set: "Tales of Middle-earth Commander", number: "400", treatment: "Surge Foil", value: 8.5 }
    ]
  },
  {
    id: "rhystic-study",
    name: "Rhystic Study",
    type: "Enchantment",
    colors: ["blue"],
    printings: [
      { id: "rhystic-study-cmm-125", set: "Commander Masters", number: "125", treatment: "Regular", value: 42.2 },
      { id: "rhystic-study-wot-25", set: "Wilds of Eldraine: Enchanting Tales", number: "25", treatment: "Showcase", value: 33.8 },
      { id: "rhystic-study-pcy-45", set: "Prophecy", number: "45", treatment: "Original", value: 63.4 }
    ]
  },
  {
    id: "dockside-extortionist",
    name: "Dockside Extortionist",
    type: "Creature",
    colors: ["red"],
    printings: [
      { id: "dockside-extortionist-2x2-107", set: "Double Masters 2022", number: "107", treatment: "Regular", value: 58.6 },
      { id: "dockside-extortionist-c19-24", set: "Commander 2019", number: "24", treatment: "Original", value: 66.75 },
      { id: "dockside-extortionist-2x2-331", set: "Double Masters 2022", number: "331", treatment: "Borderless Foil", value: 96.4 }
    ]
  },
  {
    id: "smothering-tithe",
    name: "Smothering Tithe",
    type: "Enchantment",
    colors: ["white"],
    printings: [
      { id: "smothering-tithe-rna-22", set: "Ravnica Allegiance", number: "22", treatment: "Regular", value: 28.35 },
      { id: "smothering-tithe-wot-13", set: "Wilds of Eldraine: Enchanting Tales", number: "13", treatment: "Anime", value: 41.7 },
      { id: "smothering-tithe-pip-171", set: "Fallout", number: "171", treatment: "Regular", value: 23.1 }
    ]
  },
  {
    id: "cyclonic-rift",
    name: "Cyclonic Rift",
    type: "Instant",
    colors: ["blue"],
    printings: [
      { id: "cyclonic-rift-cmm-81", set: "Commander Masters", number: "81", treatment: "Regular", value: 31.15 },
      { id: "cyclonic-rift-2xm-47", set: "Double Masters", number: "47", treatment: "Regular", value: 36.2 },
      { id: "cyclonic-rift-rtr-35", set: "Return to Ravnica", number: "35", treatment: "Original", value: 44.9 }
    ]
  },
  {
    id: "the-one-ring",
    name: "The One Ring",
    type: "Legendary Artifact",
    colors: ["colorless"],
    printings: [
      { id: "the-one-ring-ltr-246", set: "The Lord of the Rings", number: "246", treatment: "Regular", value: 72.5 },
      { id: "the-one-ring-ltr-451", set: "The Lord of the Rings", number: "451", treatment: "Borderless", value: 88.2 },
      { id: "the-one-ring-ltr-748", set: "The Lord of the Rings", number: "748", treatment: "Poster Foil", value: 138.6 }
    ]
  }
];

const conditionFactor = {
  "Near Mint": 1,
  "Lightly Played": 0.9,
  "Moderately Played": 0.78,
  "Heavily Played": 0.62,
  Damaged: 0.45
};

await ensureDataFiles();
const cards = await loadCardCatalog();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Server error" });
  }
}).listen(PORT, () => {
  console.log(`ManaBinder running at http://127.0.0.1:${PORT}`);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/session") {
    const { user } = await getSessionUser(req);
    sendJson(res, 200, { user: publicUser(user), cards: publicCards().slice(0, 60), stores: await loadStores() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cards") {
    const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(80, Number.parseInt(url.searchParams.get("limit"), 10) || 40));
    const matchingCards = query
      ? cards
        .filter((card) => card.name.toLowerCase().includes(query))
        .sort((a, b) => searchRank(a.name, query) - searchRank(b.name, query) || a.name.localeCompare(b.name))
      : cards.slice(0, limit);
    sendJson(res, 200, { cards: matchingCards.slice(0, limit).map(publicCard) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/signup") {
    const body = await readJsonBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const nickname = String(body.nickname || "").trim();
    const password = String(body.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: "Use a valid email." });
    if (nickname.length < 2 || nickname.length > 24) return sendJson(res, 400, { error: "Nickname must be 2-24 characters." });
    if (password.length < 10) return sendJson(res, 400, { error: "Password must be at least 10 characters." });

    const db = await loadDb();
    if (db.users.some((user) => user.email === email)) return sendJson(res, 409, { error: "Email already has an account." });
    if (db.users.some((user) => user.nickname.toLowerCase() === nickname.toLowerCase())) {
      return sendJson(res, 409, { error: "Nickname is already taken." });
    }

    const user = {
      id: makeId("user"),
      email,
      nickname,
      passwordHash: await hashPassword(password),
      storeIds: [],
      binder: [],
      collection: [],
      lookingFor: [],
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    await saveDb(db);
    setSessionCookie(res, user.id);
    sendJson(res, 201, { user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readJsonBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const db = await loadDb();
    const user = db.users.find((item) => item.email === email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return sendJson(res, 401, { error: "Email or password did not match." });
    }
    setSessionCookie(res, user.id);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/api/me/stores") {
    const { db, user } = await requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const validStores = new Set((await loadStores()).map((store) => store.id));
    user.storeIds = Array.isArray(body.storeIds) ? body.storeIds.filter((id) => validStores.has(id)) : [];
    await saveDb(db);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/me/binder") {
    const { db, user } = await requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const card = findCard(body.cardId);
    const printing = card?.printings.find((item) => item.id === body.printingId);
    const condition = conditionFactor[body.condition] ? body.condition : "Near Mint";
    if (!card || !printing) return sendJson(res, 400, { error: "Choose a valid card printing." });
    user.binder.push({
      id: makeId("binder"),
      cardId: card.id,
      printingId: printing.id,
      condition,
      note: String(body.note || "").slice(0, 80),
      addedAt: new Date().toISOString()
    });
    await saveDb(db);
    sendJson(res, 201, { user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/me/collection") {
    const { db, user } = await requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const card = findCard(body.cardId);
    const printing = card?.printings.find((item) => item.id === body.printingId);
    const condition = conditionFactor[body.condition] ? body.condition : "Near Mint";
    if (!card || !printing) return sendJson(res, 400, { error: "Choose a valid card printing." });
    user.collection ||= [];
    user.collection.push({
      id: makeId("collection"),
      cardId: card.id,
      printingId: printing.id,
      condition,
      quantity: Math.max(1, Math.min(99, Number.parseInt(body.quantity, 10) || 1)),
      location: String(body.location || "").slice(0, 60),
      addedAt: new Date().toISOString()
    });
    await saveDb(db);
    sendJson(res, 201, { user: publicUser(user) });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/me/collection/")) {
    const { db, user } = await requireUser(req, res);
    if (!user) return;
    const itemId = url.pathname.split("/").pop();
    user.collection = (user.collection || []).filter((item) => item.id !== itemId);
    await saveDb(db);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/me/looking-for") {
    const { db, user } = await requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const card = findCard(body.cardId);
    if (!card) return sendJson(res, 400, { error: "Choose a valid card." });
    user.lookingFor ||= [];
    if (!user.lookingFor.some((item) => item.cardId === card.id)) {
      user.lookingFor.push({
        id: makeId("want"),
        cardId: card.id,
        priority: ["Low", "Normal", "High"].includes(body.priority) ? body.priority : "Normal",
        note: String(body.note || "").slice(0, 80),
        addedAt: new Date().toISOString()
      });
    }
    await saveDb(db);
    sendJson(res, 201, { user: publicUser(user) });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/me/looking-for/")) {
    const { db, user } = await requireUser(req, res);
    if (!user) return;
    const itemId = url.pathname.split("/").pop();
    user.lookingFor = (user.lookingFor || []).filter((item) => item.id !== itemId);
    await saveDb(db);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/me/binder/")) {
    const { db, user } = await requireUser(req, res);
    if (!user) return;
    const itemId = url.pathname.split("/").pop();
    user.binder = user.binder.filter((item) => item.id !== itemId);
    await saveDb(db);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/binders") {
    const db = await loadDb();
    const stores = await loadStores();
    const storeId = url.searchParams.get("storeId");
    const wantedByUserId = url.searchParams.get("wantedByUserId");
    const wantedUser = wantedByUserId ? db.users.find((user) => user.id === wantedByUserId) : null;
    const wantedCardIds = new Set((wantedUser?.lookingFor || []).map((item) => item.cardId));
    const users = db.users
      .filter((user) => user.binder.length > 0)
      .filter((user) => !storeId || user.storeIds.includes(storeId))
      .filter((user) => wantedCardIds.size === 0 || user.binder.some((item) => wantedCardIds.has(item.cardId)))
      .map((user) => publicBinder(user, stores, wantedCardIds));
    sendJson(res, 200, { binders: users });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/trades/quote") {
    const { user } = await requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const quote = await quoteTrade(user, body);
    sendJson(res, quote.error ? 400 : 200, quote);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/trades") {
    const { db, user } = await requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const quote = await quoteTrade(user, body, db);
    if (quote.error) return sendJson(res, 400, quote);
    if (quote.state !== "even") return sendJson(res, 400, { error: "Trade must be about even before sending.", ...quote });
    const toUserId = body.toUserId || body.targetUserId;
    const targetUser = db.users.find((candidate) => candidate.id === toUserId);
    const requestedItems = resolveItems(targetUser?.binder || [], body.requestedItemIds);
    const offeredItems = resolveItems(tradableItems(user), body.offeredItemIds);
    db.trades ||= [];
    db.trades.unshift({
      id: makeId("trade"),
      fromUserId: user.id,
      toUserId: targetUser.id,
      requestedItems: requestedItems.map(snapshotTradeItem),
      offeredItems: offeredItems.map(snapshotTradeItem),
      fairnessState: quote.state,
      createdAt: new Date().toISOString()
    });
    await saveDb(db);
    sendJson(res, 201, { ok: true, quote });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function serveStatic(_req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const normalized = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const fileUrl = new URL(`.${normalized}`, PUBLIC_DIR);
  if (!fileUrl.pathname.startsWith(PUBLIC_DIR.pathname)) return sendText(res, 403, "Forbidden");
  try {
    const file = await readFile(fileUrl);
    res.writeHead(200, { "content-type": mimeTypes[extname(fileUrl.pathname)] || "application/octet-stream" });
    res.end(file);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function ensureDataFiles() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await readFile(DB_FILE, "utf8");
  } catch {
    await saveDb({ users: [], trades: [] });
  }
  try {
    await readFile(STORES_FILE, "utf8");
  } catch {
    await writeFile(STORES_FILE, JSON.stringify({ source: "pending import", importedAt: null, stores: [] }, null, 2));
  }
}

async function loadDb() {
  return JSON.parse(await readFile(DB_FILE, "utf8"));
}

async function saveDb(db) {
  await writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

async function loadStores() {
  const payload = JSON.parse(await readFile(STORES_FILE, "utf8"));
  return payload.stores || [];
}

async function loadCardCatalog() {
  try {
    const payload = JSON.parse(await readFile(CARDS_FILE, "utf8"));
    return Array.isArray(payload.cards) && payload.cards.length > 0 ? payload.cards : legacyCards;
  } catch {
    return legacyCards;
  }
}

async function requireUser(req, res) {
  const db = await loadDb();
  const session = parseSession(req);
  const user = session ? db.users.find((item) => item.id === session.userId) : null;
  if (!user) {
    sendJson(res, 401, { error: "Login required." });
    return { db, user: null };
  }
  return { db, user };
}

async function getSessionUser(req) {
  const db = await loadDb();
  const session = parseSession(req);
  const user = session ? db.users.find((item) => item.id === session.userId) : null;
  return { db, user };
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    storeIds: user.storeIds || [],
    binder: (user.binder || []).map(publicBinderItem),
    collection: (user.collection || []).map(publicCollectionItem),
    lookingFor: (user.lookingFor || []).map(publicLookingForItem)
  };
}

function publicBinder(user, stores, wantedCardIds = new Set()) {
  return {
    id: user.id,
    nickname: user.nickname,
    stores: stores.filter((store) => user.storeIds?.includes(store.id)),
    binder: user.binder.map((item) => ({
      ...publicBinderItem(item),
      wantedMatch: wantedCardIds.has(item.cardId)
    }))
  };
}

async function quoteTrade(user, body, existingDb = null) {
  const db = existingDb || await loadDb();
  const toUserId = body.toUserId || body.targetUserId;
  const targetUser = db.users.find((candidate) => candidate.id === toUserId);
  if (!targetUser || targetUser.id === user.id) return { error: "Choose another user's binder." };
  const requestedItems = resolveItems(targetUser.binder || [], body.requestedItemIds);
  const offeredItems = resolveItems(tradableItems(user), body.offeredItemIds);
  if (requestedItems.length === 0 || offeredItems.length === 0) {
    return { state: "empty", message: "Choose cards on both sides." };
  }
  const requestedPrices = await fetchCurrentPrices(requestedItems);
  const offeredPrices = await fetchCurrentPrices(offeredItems);
  const requestedTotal = requestedItems.reduce((sum, item) => sum + internalValue(item, requestedPrices), 0);
  const offeredTotal = offeredItems.reduce((sum, item) => sum + internalValue(item, offeredPrices), 0);
  const tolerance = Math.max(0.75, requestedTotal * 0.04);
  const difference = offeredTotal - requestedTotal;
  if (Math.abs(difference) <= tolerance) return { state: "even", message: "About even. Ready to send." };
  if (difference < 0) return { state: "low", message: "Add more to your offer." };
  return { state: "high", message: "Remove from your offer." };
}

function tradableItems(user) {
  return [...(user.binder || []), ...(user.collection || [])];
}

function resolveItems(sourceItems, itemIds = []) {
  const selected = new Set(Array.isArray(itemIds) ? itemIds : []);
  return sourceItems.filter((item) => selected.has(item.id));
}

function snapshotTradeItem(item) {
  return {
    id: item.id,
    cardId: item.cardId,
    printingId: item.printingId,
    condition: item.condition,
    note: item.note || "",
    quantity: item.quantity || 1
  };
}

async function fetchCurrentPrices(items) {
  const prices = new Map();
  const scryfallItems = items.filter((item) => isUuid(item.printingId));
  for (const item of items) {
    const printing = findPrinting(item);
    if (typeof printing?.value === "number") prices.set(item.printingId, printing.value);
  }
  if (scryfallItems.length === 0) return prices;

  const response = await fetch(SCRYFALL_COLLECTION_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": SCRYFALL_USER_AGENT
    },
    body: JSON.stringify({
      identifiers: [...new Set(scryfallItems.map((item) => item.printingId))].map((id) => ({ id }))
    })
  });
  if (!response.ok) throw new Error(`Scryfall price lookup failed: ${response.status}`);
  const payload = await response.json();
  for (const card of payload.data || []) {
    const price = Number.parseFloat(card.prices?.usd || card.prices?.usd_foil || card.prices?.usd_etched || "0");
    prices.set(card.id, Number.isFinite(price) ? price : 0);
  }
  return prices;
}

function internalValue(item, prices) {
  return (prices.get(item.printingId) || 0) * (conditionFactor[item.condition] || 1);
}

function publicBinderItem(item) {
  const card = findCard(item.cardId);
  const printing = card?.printings.find((candidate) => candidate.id === item.printingId);
  return {
    id: item.id,
    cardId: item.cardId,
    printingId: item.printingId,
    condition: item.condition,
    note: item.note,
    cardName: card?.name,
    type: card?.type,
    printing: printing ? `${printing.set} #${printing.number} · ${printing.treatment}` : "Unknown printing"
  };
}

function publicCollectionItem(item) {
  return {
    ...publicBinderItem(item),
    quantity: item.quantity || 1,
    location: item.location || ""
  };
}

function publicLookingForItem(item) {
  const card = findCard(item.cardId);
  return {
    id: item.id,
    cardId: item.cardId,
    cardName: card?.name || "Unknown card",
    type: card?.type || "",
    priority: item.priority || "Normal",
    note: item.note || ""
  };
}

function publicCards() {
  return cards.map(publicCard);
}

function publicCard(card) {
  return {
    id: card.id,
    name: card.name,
    type: card.type,
    colors: card.colors || ["colorless"],
    printings: card.printings.map((printing) => ({
      id: printing.id,
      set: printing.set,
      number: printing.number,
      treatment: printing.treatment,
      setCode: printing.setCode,
      rarity: printing.rarity,
      imageSmall: printing.imageSmall
    }))
  };
}

function findCard(cardId) {
  return cards.find((card) => card.id === cardId) || legacyCards.find((card) => card.id === cardId);
}

function findPrinting(item) {
  return findCard(item.cardId)?.printings.find((printing) => printing.id === item.printingId);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value));
}

function searchRank(name, query) {
  const lowerName = name.toLowerCase();
  if (lowerName === query) return 0;
  if (lowerName.startsWith(query)) return 1;
  if (lowerName.split(/\W+/).some((part) => part.startsWith(query))) return 2;
  return 3;
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${key.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  const [algorithm, salt, hash] = String(storedHash).split(":");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = await scrypt(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function setSessionCookie(res, userId) {
  const payload = Buffer.from(JSON.stringify({ userId, issuedAt: Date.now() })).toString("base64url");
  const signature = sign(payload);
  res.setHeader(
    "set-cookie",
    `${SESSION_COOKIE}=${payload}.${signature}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`
  );
}

function clearSessionCookie(res) {
  res.setHeader("set-cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function parseSession(req) {
  const cookie = parseCookies(req.headers.cookie || "")[SESSION_COOKIE];
  if (!cookie) return null;
  const [payload, signature] = cookie.split(".");
  if (!payload || !signature || sign(payload) !== signature) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function sign(payload) {
  return createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

function parseCookies(header) {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
  );
}

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, payload) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(payload);
}

function makeId(prefix) {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}
