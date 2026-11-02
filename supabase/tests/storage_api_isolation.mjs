// Storage isolation through the real Storage API (deletes cannot be tested
// in SQL because Supabase blocks direct deletes from storage tables).
//
// Requires a running local stack (`npx supabase@2.122.0 start`). Creates two
// throwaway users with random emails and a random password, then checks that
// user A cannot read, overwrite, upload into, list or delete user B's files.
//
// Run: SUPABASE_PUBLISHABLE_KEY=<from `supabase status`> node supabase/tests/storage_api_isolation.mjs

import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";

const API = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!KEY) {
  console.error("Set SUPABASE_PUBLISHABLE_KEY (see `npx supabase@2.122.0 status`).");
  process.exit(2);
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`not ok - ${name}\n  ${err.message}`);
  }
}

async function signUp() {
  const email = `storage-${randomUUID()}@example.test`;
  const password = randomBytes(18).toString("base64url");
  const res = await fetch(`${API}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, `signup failed: ${JSON.stringify(body)}`);
  return { id: body.user.id, token: body.access_token };
}

function headers(user, extra = {}) {
  return { apikey: KEY, authorization: `Bearer ${user.token}`, ...extra };
}

async function insertRow(user, table, row) {
  const res = await fetch(`${API}/rest/v1/${table}`, {
    method: "POST",
    headers: headers(user, { "content-type": "application/json", prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  const body = await res.json();
  assert.equal(res.status, 201, `${table} insert failed: ${JSON.stringify(body)}`);
  return body[0];
}

// Minimal valid header followed by silence; content does not matter here.
function wavBytes() {
  const data = Buffer.alloc(16000 * 2 * 10);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function upload(user, path, { upsert = false } = {}) {
  return fetch(`${API}/storage/v1/object/recordings/${path}`, {
    method: "POST",
    headers: headers(user, { "content-type": "audio/wav", "x-upsert": String(upsert) }),
    body: wavBytes(),
  });
}

const a = await signUp();
const b = await signUp();

const machineB = await insertRow(b, "machines", { name: "B storage test machine" });
const recordingId = randomUUID();
const pathB = `${b.id}/${machineB.id}/${recordingId}.wav`;
await insertRow(b, "recordings", { id: recordingId, machine_id: machineB.id, storage_path: pathB });

await check("B can upload own recording file", async () => {
  const res = await upload(b, pathB);
  assert.equal(res.status, 200, await res.text());
});

await check("A cannot download B file", async () => {
  const res = await fetch(`${API}/storage/v1/object/authenticated/recordings/${pathB}`, { headers: headers(a) });
  assert.notEqual(res.status, 200);
});

await check("A cannot list B folder", async () => {
  const res = await fetch(`${API}/storage/v1/object/list/recordings`, {
    method: "POST",
    headers: headers(a, { "content-type": "application/json" }),
    body: JSON.stringify({ prefix: `${b.id}/${machineB.id}` }),
  });
  const body = await res.json();
  assert.ok(Array.isArray(body) && body.length === 0, JSON.stringify(body));
});

await check("A cannot overwrite B file", async () => {
  const res = await upload(a, pathB, { upsert: true });
  assert.notEqual(res.status, 200);
});

await check("A cannot upload into B folder", async () => {
  const res = await upload(a, `${b.id}/${machineB.id}/${randomUUID()}.wav`);
  assert.notEqual(res.status, 200);
});

await check("A cannot delete B file", async () => {
  await fetch(`${API}/storage/v1/object/recordings`, {
    method: "DELETE",
    headers: headers(a, { "content-type": "application/json" }),
    body: JSON.stringify({ prefixes: [pathB] }),
  });
  const res = await fetch(`${API}/storage/v1/object/authenticated/recordings/${pathB}`, { headers: headers(b) });
  assert.equal(res.status, 200, "B file is gone after A delete attempt");
});

await check("B cannot overwrite own file (recordings are immutable)", async () => {
  const res = await upload(b, pathB, { upsert: true });
  assert.notEqual(res.status, 200);
});

await check("anonymous caller cannot download B file", async () => {
  const res = await fetch(`${API}/storage/v1/object/authenticated/recordings/${pathB}`, { headers: { apikey: KEY } });
  assert.notEqual(res.status, 200);
});

await check("B can delete own file", async () => {
  const res = await fetch(`${API}/storage/v1/object/recordings`, {
    method: "DELETE",
    headers: headers(b, { "content-type": "application/json" }),
    body: JSON.stringify({ prefixes: [pathB] }),
  });
  const body = await res.json();
  assert.ok(Array.isArray(body) && body.length === 1, JSON.stringify(body));
});

console.log(failures === 0 ? "\nAll storage isolation checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
