// Account deletion end to end: DELETE /v1/account removes the user's audio
// files, their rows and their login. Also checks the recording caps' error
// codes reach the Data API client.
//
// Requires the local stack and the inference service (with SUPABASE_SECRET_KEY)
// running. Creates a throwaway user with a random email and password.
//
// Run: SUPABASE_PUBLISHABLE_KEY=<key> SUPABASE_SECRET_KEY=<key> \
//      node supabase/tests/account_deletion.mjs

import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";

const API = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const INFERENCE = process.env.INFERENCE_API_URL ?? "http://127.0.0.1:8000";
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!KEY || !SECRET) {
  console.error("Set SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (see `npx supabase@2.122.0 status`).");
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

const email = `delete-${randomUUID()}@example.test`;
const password = randomBytes(18).toString("base64url");
const signup = await fetch(`${API}/auth/v1/signup`, {
  method: "POST",
  headers: { apikey: KEY, "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
}).then((r) => r.json());
const user = { id: signup.user.id, token: signup.access_token };
const asUser = (extra = {}) => ({ apikey: KEY, authorization: `Bearer ${user.token}`, ...extra });
const asService = (extra = {}) => ({ apikey: SECRET, ...extra });

async function insert(table, row) {
  const res = await fetch(`${API}/rest/v1/${table}`, {
    method: "POST",
    headers: asUser({ "content-type": "application/json", prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  return { status: res.status, body: await res.json() };
}

function wav() {
  const data = Buffer.alloc(16000 * 2 * 10);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const machine = (await insert("machines", { name: "deletion test", machine_type: "gearbox" })).body[0];
const files = [];
for (let i = 0; i < 3; i++) {
  const id = randomUUID();
  const path = `${user.id}/${machine.id}/${id}.wav`;
  await insert("recordings", { id, machine_id: machine.id, storage_path: path, kind: "baseline" });
  const up = await fetch(`${API}/storage/v1/object/recordings/${path}`, {
    method: "POST",
    headers: asUser({ "content-type": "audio/wav" }),
    body: wav(),
  });
  assert.equal(up.status, 200, await up.text());
  files.push(path);
}

await check("the cap error code reaches the client (51st baseline)", async () => {
  // Fill to 50 baselines through the service role, then try one more as the user.
  const rows = Array.from({ length: 47 }, () => {
    const id = randomUUID();
    return { id, machine_id: machine.id, owner_id: user.id, kind: "baseline", storage_path: `${user.id}/${machine.id}/${id}.wav` };
  });
  const fill = await fetch(`${API}/rest/v1/recordings`, {
    method: "POST",
    headers: asService({ "content-type": "application/json" }),
    body: JSON.stringify(rows),
  });
  assert.equal(fill.status, 201, await fill.text());
  const id = randomUUID();
  const res = await insert("recordings", {
    id, machine_id: machine.id, kind: "baseline", storage_path: `${user.id}/${machine.id}/${id}.wav`,
  });
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.message, "baseline_limit_reached");
});

await check("account deletion needs the confirmation phrase", async () => {
  const res = await fetch(`${INFERENCE}/v1/account`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" },
    body: JSON.stringify({ confirm: "yes" }),
  });
  assert.equal(res.status, 422);
});

await check("DELETE /v1/account succeeds", async () => {
  const res = await fetch(`${INFERENCE}/v1/account`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" },
    body: JSON.stringify({ confirm: "delete my account" }),
  });
  assert.equal(res.status, 204, await res.text());
});

await check("no audio is left under the user's prefix", async () => {
  const res = await fetch(`${API}/storage/v1/object/list/recordings`, {
    method: "POST",
    headers: asService({ "content-type": "application/json" }),
    body: JSON.stringify({ prefix: `${user.id}/${machine.id}`, limit: 1000 }),
  });
  const body = await res.json();
  assert.ok(Array.isArray(body) && body.length === 0, JSON.stringify(body));
});

await check("the user's rows are gone", async () => {
  for (const table of ["machines", "recordings", "profiles"]) {
    const column = table === "profiles" ? "id" : "owner_id";
    const res = await fetch(`${API}/rest/v1/${table}?${column}=eq.${user.id}&select=*`, { headers: asService() });
    const body = await res.json();
    assert.equal(body.length, 0, `${table}: ${JSON.stringify(body).slice(0, 200)}`);
  }
});

await check("the user can no longer sign in", async () => {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.notEqual(res.status, 200);
});

console.log(failures === 0 ? "\nAll account deletion checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
