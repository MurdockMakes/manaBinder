import { readFile } from "node:fs/promises";
import { check } from "./security.js";
export class Catalog {
  constructor(cards, stores, importedAt = new Date().toISOString()) {
    check(
      Array.isArray(cards) &&
        cards.length > 0 &&
        Array.isArray(stores) &&
        stores.length > 0,
      503,
      "Catalog and stores required",
    );
    this.cards = cards;
    this.stores = stores;
    this.importedAt = importedAt;
    this.byId = new Map();
    this.printings = new Map();
    for (const card of cards) {
      check(
        typeof card.id === "string" &&
          !this.byId.has(card.id) &&
          Array.isArray(card.printings) &&
          card.printings.length > 0,
        503,
        "Invalid catalog",
      );
      this.byId.set(card.id, card);
      for (const p of card.printings) {
        check(
          !this.printings.has(p.id) &&
            Array.isArray(p.finishes) &&
            p.finishes.length > 0,
          503,
          "Invalid printing",
        );
        this.printings.set(p.id, { ...p, cardId: card.id });
      }
    }
    this.searchNames = cards.map((c) => [c, c.name.toLowerCase()]);
    this.grams = new Map();
    for (let index = 0; index < this.searchNames.length; index++) {
      const name = this.searchNames[index][1],
        unique = new Set();
      for (let i = 0; i < name.length - 2; i++)
        unique.add(name.slice(i, i + 3));
      for (const gram of unique) {
        if (!this.grams.has(gram)) this.grams.set(gram, []);
        this.grams.get(gram).push(index);
      }
    }
    this.queryCache = new Map();
    this.storeIds = new Set(stores.map((s) => s.id));
  }
  search(query = "", limit = 40, offset = 0) {
    const q = query.toLowerCase();
    if (!q)
      return {
        cards: this.cards
          .slice(offset, offset + limit)
          .map((c) => this.publicCard(c)),
        nextOffset: offset + limit < this.cards.length ? offset + limit : null,
      };
    let found = this.queryCache.get(q);
    if (!found) {
      let candidates;
      for (let i = 0; i < q.length - 2; i++) {
        const ids = this.grams.get(q.slice(i, i + 3)) || [];
        if (!candidates || ids.length < candidates.length) candidates = ids;
      }
      found = (
        candidates
          ? candidates.map((i) => this.searchNames[i])
          : this.searchNames
      ).filter(([, n]) => n.includes(q));
    }
    if (q)
      found.sort(
        (a, b) =>
          Number(b[1] === q) - Number(a[1] === q) ||
          Number(b[1].startsWith(q)) - Number(a[1].startsWith(q)),
      );
    this.queryCache.delete(q);
    this.queryCache.set(q, found);
    if (this.queryCache.size > 256)
      this.queryCache.delete(this.queryCache.keys().next().value);
    return {
      cards: found
        .slice(offset, offset + limit)
        .map(([c]) => this.publicCard(c)),
      nextOffset: offset + limit < found.length ? offset + limit : null,
    };
  }
  publicCard(c) {
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      colors: c.colors,
      printings: c.printings.map((p) => ({
        id: p.id,
        set: p.set,
        number: p.number,
        treatment: p.treatment,
        setCode: p.setCode,
        rarity: p.rarity,
        imageSmall: p.imageSmall,
        finishes: p.finishes,
        lang: p.lang,
      })),
    };
  }
  item(i, privateFields = false) {
    const c = this.byId.get(i.card_id),
      p = this.printings.get(i.printing_id);
    return {
      id: i.id,
      cardId: i.card_id,
      printingId: i.printing_id,
      finish: i.finish,
      quantity: i.quantity,
      condition: i.condition,
      note: i.note,
      cardName: c?.name || "Unavailable card",
      type: c?.type || "",
      printing: p
        ? `${p.set} #${p.number} · ${p.treatment} · ${i.finish}`
        : "Unavailable printing",
      ...(privateFields ? { location: i.location } : {}),
    };
  }
}
export async function loadCatalog() {
  const base = new URL("../data/", import.meta.url);
  const cards = JSON.parse(
    await readFile(new URL("cards.scryfall.json", base), "utf8"),
  );
  const stores = JSON.parse(
    await readFile(new URL("stores.massachusetts.json", base), "utf8"),
  );
  return new Catalog(
    cards.cards,
    stores.stores,
    [cards.importedAt, stores.importedAt].sort()[0],
  );
}
