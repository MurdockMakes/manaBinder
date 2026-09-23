import { atomicJson, validateStores } from "../src/imports.js";

const ENDPOINT =
  "https://api.tabletop.wizards.com/silverbeak-griffin-service/graphql";
const OUTPUT_FILE = new URL(
  "../data/stores.massachusetts.json",
  import.meta.url,
);
const MASSACHUSETTS_CENTER = { latitude: 42.4072, longitude: -71.3824 };
const MAX_METERS = 230000;

const query = `
  query getStoresByLocation(
    $latitude: Float!
    $longitude: Float!
    $maxMeters: Int!
    $pageSize: Int
    $page: Int
    $isPremium: Boolean
  ) {
    storesByLocation(
      input: {
        latitude: $latitude
        longitude: $longitude
        maxMeters: $maxMeters
        pageSize: $pageSize
        page: $page
        isPremium: $isPremium
      }
    ) {
      stores {
        id
        isPremium
        latitude
        longitude
        name
        postalAddress
        phoneNumber
        website
      }
      pageInfo {
        page
        pageSize
        totalResults
      }
    }
  }
`;

const allStores = new Map();
for (let page = 0; page < 100; page++) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent":
        process.env.SCRYFALL_USER_AGENT || "ManaBinder/0.2 local-development",
    },
    body: JSON.stringify({
      query,
      variables: {
        ...MASSACHUSETTS_CENTER,
        maxMeters: MAX_METERS,
        pageSize: 100,
        page,
        isPremium: null,
      },
    }),
  });
  if (!response.ok)
    throw Error("Store import request failed: " + response.status);
  const payload = await response.json();
  if (
    payload.errors?.length ||
    !Array.isArray(payload.data?.storesByLocation?.stores)
  )
    throw Error("Store GraphQL errors or missing data");
  const result = payload.data.storesByLocation;
  const previous = allStores.size;
  for (const store of result.stores) allStores.set(store.id, store);
  if (!Number.isInteger(result.pageInfo?.totalResults))
    throw Error("Missing store pagination metadata");
  if (allStores.size >= result.pageInfo.totalResults) break;
  if (previous === allStores.size || page === 99)
    throw Error("Incomplete store pagination");
}
const stores = [...allStores.values()]
  .filter((store) => isMassachusettsAddress(store.postalAddress))
  .map((store) => ({
    id: `wpn-${store.id}`,
    wpnId: store.id,
    name: clean(store.name),
    address: cleanAddress(store.postalAddress),
    phone: clean(store.phoneNumber),
    website: store.website || null,
    isPremium: Boolean(store.isPremium),
    latitude: store.latitude,
    longitude: store.longitude,
    source: "Wizards Store and Event Locator",
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

await atomicJson(
  OUTPUT_FILE,
  {
    source: "Wizards Store and Event Locator storesByLocation GraphQL query",
    sourceUrl: "https://locator.wizards.com/",
    importedAt: new Date().toISOString(),
    state: "MA",
    stores,
  },
  validateStores,
);

console.log(
  `Imported ${stores.length} Massachusetts WPN stores into ${OUTPUT_FILE.pathname}`,
);

function isMassachusettsAddress(address) {
  const normalized = cleanAddress(address);
  return /,\s*MA(?:,|\s+\d{5}|\s|$)/i.test(normalized);
}

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAddress(value) {
  return clean(value).replace(/\s+,/g, ",");
}
