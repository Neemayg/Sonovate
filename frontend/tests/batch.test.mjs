// Run with `npm test` (node --test; Node strips the TypeScript types itself).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addFiles,
  canRemove,
  clearDone,
  formatBytes,
  isAcceptedFile,
  pendingKeys,
  removeItem,
  requeueFailed,
  summarise,
  updateItem,
} from "../src/lib/batch.ts";

const file = (name, size = 1000, type = "", lastModified = 1) => new File([new Uint8Array(size)], name, { type, lastModified });

test("accepts the formats the converter handles and rejects others", () => {
  for (const n of ["a.wav", "b.MP3", "c.m4a", "d.mp4", "e.MOV", "f.webm"]) assert.equal(isAcceptedFile(file(n)), true, n);
  assert.equal(isAcceptedFile(file("notes.txt")), false);
  assert.equal(isAcceptedFile(file("pic.png", 10, "image/png")), false);
  assert.equal(isAcceptedFile(file("noext", 10, "audio/x-custom")), true);
});

test("addFiles skips unsupported files and duplicates", () => {
  const a = file("a.wav");
  let r = addFiles([], [a, file("x.txt"), a]);
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.unsupported, ["x.txt"]);
  assert.deepEqual(r.duplicates, ["a.wav"]);
  r = addFiles(r.items, [file("a.wav"), file("b.wav")]);
  assert.equal(r.items.length, 2, "same name, size and time is the same file");
  assert.ok(r.items.every((i) => i.status === "queued"));
});

test("only queued or failed files can be removed", () => {
  let { items } = addFiles([], [file("a.wav"), file("b.wav"), file("c.wav")]);
  const [a, b, c] = items.map((i) => i.key);
  items = updateItem(items, a, { status: "done" });
  items = updateItem(items, b, { status: "uploading" });
  items = updateItem(items, c, { status: "failed", error: "x" });
  assert.equal(canRemove(items[0]), false);
  items = removeItem(removeItem(removeItem(items, a), b), c);
  assert.deepEqual(items.map((i) => i.key), [a, b]);
});

test("retry re-queues failed files only and never done ones", () => {
  let { items } = addFiles([], [file("a.wav"), file("b.wav"), file("c.wav")]);
  const [a, b, c] = items.map((i) => i.key);
  items = updateItem(items, a, { status: "done", recordingId: "r1" });
  items = updateItem(items, b, { status: "failed", error: "Upload failed." });
  items = updateItem(items, c, { status: "failed", error: "Too short." });
  assert.deepEqual(pendingKeys(items, false), []);
  assert.deepEqual(pendingKeys(items, true), [b, c]);
  const one = requeueFailed(items, b);
  assert.deepEqual(pendingKeys(one, false), [b]);
  assert.equal(one.find((i) => i.key === b).error, undefined);
  const all = requeueFailed(items);
  assert.deepEqual(pendingKeys(all, false), [b, c]);
  assert.equal(all.find((i) => i.key === a).status, "done");
});

test("summary counts and clearing finished files", () => {
  let { items } = addFiles([], [file("a.wav"), file("b.wav")]);
  items = updateItem(items, items[0].key, { status: "done" });
  assert.deepEqual(summarise(items), { queued: 1, preparing: 0, uploading: 0, done: 1, failed: 0, total: 2 });
  assert.equal(clearDone(items).length, 1);
});

test("formatBytes", () => {
  assert.equal(formatBytes(500), "500 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(3.5 * 1024 * 1024), "3.5 MB");
});
