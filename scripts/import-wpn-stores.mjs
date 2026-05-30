import { writeFile } from "node:fs/promises";

const ENDPOINT = "https://api.tabletop.wizards.com/silverbeak-griffin-service/graphql";
const OUTPUT_FILE = new URL("../data/stores.massachusetts.json", import.meta.url);
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

const response = await fetch(ENDPOINT, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json",
    "user-agent": "ManaBinder/0.1 store-import contact=local-development"
  },
  body: JSON.stringify({
    query,
    variables: {
      ...MASSACHUSETTS_CENTER,
      maxMeters: MAX_METERS,
      pageSize: 1000,
      page: 0,
      isPremium: null
    }
  })
});

if (!response.ok) {
  throw new Error(`WPN locator request failed: ${response.status} ${response.statusText}`);
}

const payload = await response.json();
const stores = payload.data.storesByLocation.stores
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
    source: "Wizards Store and Event Locator"
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

await writeFile(
  OUTPUT_FILE,
  JSON.stringify(
    {
      source: "Wizards Store and Event Locator storesByLocation GraphQL query",
      sourceUrl: "https://locator.wizards.com/",
      importedAt: new Date().toISOString(),
      state: "MA",
      stores
    },
    null,
    2
  )
);

console.log(`Imported ${stores.length} Massachusetts WPN stores into ${OUTPUT_FILE.pathname}`);

function isMassachusettsAddress(address) {
  const normalized = cleanAddress(address);
  return /,\s*MA(?:,|\s+\d{5}|\s|$)/i.test(normalized);
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanAddress(value) {
  return clean(value).replace(/\s+,/g, ",");
}
