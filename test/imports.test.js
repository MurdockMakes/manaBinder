import test from "node:test";
import assert from "node:assert/strict";
import { streamJsonArray, atomicJson } from "../src/imports.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
test("bulk parser rejects truncation, trailing garbage and commas", async () => {
  for (const input of [
    '[{"a":1}',
    '[{"a":1},]',
    '[{"a":1}] garbage',
    '{"a":1}',
    '[{"a":"unterminated',
  ])
    await assert.rejects(async () => {
      for await (const _ of streamJsonArray([Buffer.from(input)])) {
      }
    });
  const out = [];
  for await (const row of streamJsonArray([
    Buffer.from('[{"a":"}\\\""},'),
    Buffer.from('{"b":[1,2]}]'),
  ]))
    out.push(row);
  assert.equal(out.length, 2);
});
test("invalid import keeps last good file", async () => {
  await mkdir("work", { recursive: true });
  const url = new URL("../work/import-test.json", import.meta.url);
  await writeFile(url, '{"ok":true}');
  await assert.rejects(() =>
    atomicJson(url, {}, (p) => {
      if (!p.ok) throw Error("invalid");
    }),
  );
  assert.deepEqual(JSON.parse(await readFile(url, "utf8")), { ok: true });
  await atomicJson(url, { ok: 2 }, () => {});
  assert.deepEqual(
    JSON.parse(await readFile(new URL(url.href + ".previous"), "utf8")),
    { ok: true },
  );
});
