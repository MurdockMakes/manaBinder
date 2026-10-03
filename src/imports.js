import { writeFile, readFile, rename, copyFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
export async function atomicJson(path, payload, validate) {
  validate(payload);
  const target = path instanceof URL ? path : new URL(path, "file:///");
  const temp = new URL(
    target.href + "." + randomBytes(6).toString("hex") + ".tmp",
  );
  await writeFile(temp, JSON.stringify(payload, null, 2));
  validate(JSON.parse(await readFile(temp, "utf8")));
  try {
    await copyFile(target, new URL(target.href + ".previous"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await rename(temp, target);
}
// Full outer-array grammar and complete EOF are mandatory before publishing an import.
export async function* streamJsonArray(readable) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let phase = "start",
    current = "",
    depth = 0,
    inString = false,
    escaped = false;
  for await (const chunk of readable) {
    for (const char of decoder.decode(chunk, { stream: true })) {
      if (depth === 0) {
        if (/\s/.test(char)) continue;
        if (phase === "start" && char === "[") {
          phase = "first";
          continue;
        }
        if ((phase === "first" || phase === "after") && char === "]") {
          phase = "done";
          continue;
        }
        if (phase === "after" && char === ",") {
          phase = "next";
          continue;
        }
        if ((phase === "first" || phase === "next") && char === "{") {
          depth = 1;
          current = "{";
          inString = false;
          escaped = false;
          phase = "item";
          continue;
        }
        throw Error("Invalid bulk array structure");
      }
      current += char;
      if (current.length > 2_000_000) throw Error("Oversized bulk item");
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === "{") depth++;
      else if (char === "}") depth--;
      if (depth === 0) {
        yield JSON.parse(current);
        current = "";
        phase = "after";
      }
    }
  }
  decoder.decode();
  if (phase !== "done" || depth !== 0) throw Error("Truncated bulk array");
}
export function validateCards(p) {
  if (!Array.isArray(p.cards) || p.cards.length === 0 || !p.importedAt)
    throw Error("Empty card import");
  const ids = new Set();
  for (const c of p.cards) {
    if (!c.id || !c.name || !Array.isArray(c.printings) || !c.printings.length)
      throw Error("Invalid card");
    for (const i of c.printings) {
      if (!i.id || ids.has(i.id) || !i.finishes?.length)
        throw Error("Invalid or duplicate printing");
      ids.add(i.id);
    }
  }
}
export function validateStores(p) {
  if (
    !Array.isArray(p.stores) ||
    !p.stores.length ||
    new Set(p.stores.map((s) => s.id)).size !== p.stores.length
  )
    throw Error("Invalid store import");
  for (const s of p.stores)
    if (!s.id || !s.name || !s.address) throw Error("Invalid store");
}
