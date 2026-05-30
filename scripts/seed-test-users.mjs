import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const DB_FILE = new URL("../data/db.json", import.meta.url);
const now = new Date().toISOString();

const testUsers = [
  {
    id: "test_user_valley_mage",
    email: "valley.mage@example.test",
    nickname: "ValleyMage",
    storeIds: ["wpn-18515", "wpn-5780"],
    binder: [
      binder("rhystic-study", "rhystic-study-pcy-45", "Lightly Played", "Original printing"),
      binder("cyclonic-rift", "cyclonic-rift-rtr-35", "Near Mint", ""),
      binder("smothering-tithe", "smothering-tithe-rna-22", "Near Mint", "")
    ],
    collection: [
      collection("sol-ring", "sol-ring-ltc-400", "Near Mint", 2, "Trade case")
    ]
  },
  {
    id: "test_user_boston_stack",
    email: "boston.stack@example.test",
    nickname: "BostonStack",
    storeIds: ["wpn-9010", "wpn-9714"],
    binder: [
      binder("the-one-ring", "the-one-ring-ltr-451", "Near Mint", "Borderless"),
      binder("dockside-extortionist", "dockside-extortionist-2x2-107", "Near Mint", ""),
      binder("sol-ring", "sol-ring-cmm-394", "Near Mint", "")
    ],
    collection: [
      collection("rhystic-study", "rhystic-study-wot-25", "Near Mint", 1, "Blue staples")
    ]
  },
  {
    id: "test_user_northshore_edh",
    email: "northshore.edh@example.test",
    nickname: "NorthshoreEDH",
    storeIds: ["wpn-9020", "wpn-9538"],
    binder: [
      binder("the-one-ring", "the-one-ring-ltr-748", "Near Mint", "Poster foil"),
      binder("cyclonic-rift", "cyclonic-rift-2xm-47", "Lightly Played", ""),
      binder("dockside-extortionist", "dockside-extortionist-c19-24", "Moderately Played", "")
    ],
    collection: []
  }
];

const db = JSON.parse(await readFile(DB_FILE, "utf8"));
db.users = db.users.filter((user) => !user.id.startsWith("test_user_"));

for (const user of testUsers) {
  db.users.push({
    ...user,
    passwordHash: await hashPassword("testpassword123"),
    createdAt: now
  });
}

await writeFile(DB_FILE, JSON.stringify(db, null, 2));
console.log(`Seeded ${testUsers.length} test users with trade binders.`);

function binder(cardId, printingId, condition, note) {
  return {
    id: `test_binder_${randomBytes(5).toString("hex")}`,
    cardId,
    printingId,
    condition,
    note,
    addedAt: now
  };
}

function collection(cardId, printingId, condition, quantity, location) {
  return {
    id: `test_collection_${randomBytes(5).toString("hex")}`,
    cardId,
    printingId,
    condition,
    quantity,
    location,
    addedAt: now
  };
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${key.toString("hex")}`;
}
