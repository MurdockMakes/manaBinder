import { writeFile } from "node:fs/promises";

const BULK_ENDPOINT = "https://api.scryfall.com/bulk-data";
const OUTPUT_FILE = new URL("../data/cards.scryfall.json", import.meta.url);
const USER_AGENT = "ManaBinder/0.1 full-card-import contact=local-development";

const bulkResponse = await fetch(BULK_ENDPOINT, {
  headers: {
    accept: "application/json",
    "user-agent": USER_AGENT
  }
});

if (!bulkResponse.ok) {
  throw new Error(`Scryfall bulk metadata request failed: ${bulkResponse.status} ${bulkResponse.statusText}`);
}

const bulkPayload = await bulkResponse.json();
const defaultCards = bulkPayload.data.find((item) => item.type === "default_cards");
if (!defaultCards?.download_uri) {
  throw new Error("Could not find Scryfall default_cards bulk file.");
}

console.log(`Downloading ${defaultCards.name} updated ${defaultCards.updated_at}`);
const cardsResponse = await fetch(defaultCards.download_uri, {
  headers: {
    accept: "application/json",
    "user-agent": USER_AGENT
  }
});

if (!cardsResponse.ok) {
  throw new Error(`Scryfall card download failed: ${cardsResponse.status} ${cardsResponse.statusText}`);
}

const grouped = new Map();

let processed = 0;
for await (const rawCard of streamJsonArray(cardsResponse.body)) {
  processed += 1;
  if (processed % 25000 === 0) console.log(`Processed ${processed} Scryfall card objects...`);
  if (!rawCard.games?.includes("paper")) continue;
  if (rawCard.object !== "card") continue;
  if (["token", "card"].includes(rawCard.layout) && rawCard.type_line?.startsWith("Token")) continue;

  const cardId = rawCard.oracle_id || `scryfall-card-${rawCard.id}`;
  const existing = grouped.get(cardId);
  const card = existing || {
    id: cardId,
    name: rawCard.name,
    type: rawCard.type_line || "Unknown",
    colors: rawCard.colors?.length ? rawCard.colors.map(mapColor) : ["colorless"],
    printings: []
  };

  card.printings.push({
    id: rawCard.id,
    set: rawCard.set_name,
    setCode: rawCard.set,
    number: rawCard.collector_number,
    treatment: treatment(rawCard),
    rarity: rawCard.rarity,
    releasedAt: rawCard.released_at,
    imageSmall: imageUri(rawCard, "small"),
    imageNormal: imageUri(rawCard, "normal"),
    scryfallUri: rawCard.scryfall_uri,
    finishes: rawCard.finishes || [],
    lang: rawCard.lang
  });

  grouped.set(cardId, card);
}

const cards = [...grouped.values()]
  .map((card) => ({
    ...card,
    printings: card.printings.sort((a, b) => {
      const dateCompare = String(b.releasedAt || "").localeCompare(String(a.releasedAt || ""));
      return dateCompare || String(a.set).localeCompare(String(b.set)) || String(a.number).localeCompare(String(b.number));
    })
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

await writeFile(
  OUTPUT_FILE,
  JSON.stringify(
    {
      source: "Scryfall Default Cards bulk data",
      sourceUrl: "https://scryfall.com/docs/api/bulk-data",
      importedAt: new Date().toISOString(),
      scryfallUpdatedAt: defaultCards.updated_at,
      pricesIncluded: false,
      cards
    },
    null,
    2
  )
);

console.log(`Imported ${cards.length} cards with ${cards.reduce((sum, card) => sum + card.printings.length, 0)} printings.`);
console.log(`Wrote ${OUTPUT_FILE.pathname}`);

function mapColor(color) {
  return {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green"
  }[color] || "colorless";
}

function imageUri(card, size) {
  return card.image_uris?.[size] || card.card_faces?.find((face) => face.image_uris)?.image_uris?.[size] || null;
}

function treatment(card) {
  const labels = [];
  if (card.border_color === "borderless") labels.push("Borderless");
  if (card.frame_effects?.includes("showcase")) labels.push("Showcase");
  if (card.frame_effects?.includes("extendedart")) labels.push("Extended Art");
  if (card.frame_effects?.includes("inverted")) labels.push("Inverted");
  if (card.promo) labels.push("Promo");
  if (card.finishes?.includes("etched")) labels.push("Etched");
  if (card.finishes?.includes("foil") && !card.finishes?.includes("nonfoil")) labels.push("Foil");
  return labels.length ? labels.join(" ") : "Regular";
}

async function* streamJsonArray(readable) {
  const decoder = new TextDecoder();
  let current = "";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for await (const chunk of readable) {
    const text = decoder.decode(chunk, { stream: true });
    for (const char of text) {
      if (depth === 0) {
        if (char === "{") {
          current = "{";
          depth = 1;
          inString = false;
          escaped = false;
        }
        continue;
      }

      current += char;

      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;

      if (depth === 0) {
        yield JSON.parse(current);
        current = "";
      }
    }
  }
}
