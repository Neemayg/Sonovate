// Shared helpers for the local seeders (seed-demo.mjs, seed-test-data.mjs).
// Everything goes through the same paths the app uses: the user's own session
// (row-level security applies), the `recordings` bucket, and the inference
// service for every result. Nothing here writes scores, thresholds or decisions.

import { createClient } from "@supabase/supabase-js";
import path from "node:path";

export const BUCKET = "recordings";

export function die(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

export function isLoopback(url) {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

// Reads frontend/.env.local values and refuses anything but a local stack.
export async function localStack(command) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const inferenceUrl = process.env.NEXT_PUBLIC_INFERENCE_API_URL ?? "";
  if (!supabaseUrl || !publishableKey || !inferenceUrl) {
    die(`Missing NEXT_PUBLIC_* settings. Run with: npm run ${command} (it reads frontend/.env.local).`);
  }
  if (!isLoopback(supabaseUrl) || !isLoopback(inferenceUrl)) {
    die("The seeders only run against a local stack (localhost / 127.0.0.1).");
  }
  return { supabaseUrl, publishableKey, inferenceUrl };
}

export async function requireInference(inferenceUrl) {
  const health = await fetch(`${inferenceUrl}/v1/health`).catch(() => null);
  if (!health?.ok) die(`The inference service is not reachable at ${inferenceUrl}. Start it first (backend/README.md).`);
}

// Signs in, or signs up first (local stack: no email confirmation).
export async function signIn({ supabaseUrl, publishableKey }, email, password) {
  const db = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false } });
  let { data: auth, error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    const signUp = await db.auth.signUp({ email, password });
    if (signUp.error) die(`Could not create ${email}: ${signUp.error.message}`);
    ({ data: auth, error } = await db.auth.signInWithPassword({ email, password }));
    if (error) die(`Could not sign in as ${email}: ${error.message}`);
    console.log(`Created account ${email}`);
  } else {
    console.log(`Signed in as ${email}`);
  }
  return { db, userId: auth.user.id, token: auth.session.access_token };
}

// Same steps as deleteMachine in src/lib/api.ts: stored audio, then the row (cascades).
export async function deleteMachines(db, userId, machines) {
  for (const m of machines) {
    const folder = `${userId}/${m.id}`;
    const { data: objects } = await db.storage.from(BUCKET).list(folder, { limit: 1000 });
    const paths = (objects ?? []).map((o) => `${folder}/${o.name}`);
    if (paths.length > 0) await db.storage.from(BUCKET).remove(paths);
    const { error } = await db.from("machines").delete().eq("id", m.id);
    if (error) die(`Could not delete ${m.name}: ${error.message}`);
    console.log(`Deleted ${m.name}`);
  }
}

// Minimal WAV header read, mirroring src/lib/wav.ts; the service re-checks.
export function wavInfo(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let fmt = null;
  let dataLength = null;
  for (let pos = 12; pos + 8 <= buf.length; ) {
    const id = tag(pos);
    const size = view.getUint32(pos + 4, true);
    if (id === "fmt ") {
      fmt = {
        channels: view.getUint16(pos + 10, true),
        rate: view.getUint32(pos + 12, true),
        block: view.getUint16(pos + 20, true),
      };
    } else if (id === "data") {
      dataLength = Math.min(size, buf.length - pos - 8);
      break;
    }
    pos += 8 + size + (size % 2);
  }
  if (!fmt || dataLength === null) throw new Error("WAV is missing its format or data section");
  return { sampleRateHz: fmt.rate, channels: fmt.channels, durationSeconds: dataLength / fmt.block / fmt.rate };
}

// Deterministic shuffle (mulberry32), so the draw is fixed before any result is seen.
export function shuffled(items, seed) {
  let t = seed >>> 0;
  const rand = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// PCM bytes of a WAV's data chunk (the clips are 16 kHz mono 16-bit).
export function pcm(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let pos = 12; pos + 8 <= buf.length; ) {
    const id = String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]);
    const size = view.getUint32(pos + 4, true);
    if (id === "data") return buf.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

// 16 kHz mono 16-bit WAV from PCM bytes.
export function wavBytes(data) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// Joins separate clips of one label into one recording (ADR-012 60 s checks).
export function joinClips(buffers) {
  return wavBytes(Buffer.concat(buffers.map(pcm)));
}

// Stores one recording as the upload form does: row, then audio, then optional context.
export async function uploadRecording(db, userId, machineId, { filename, bytes, kind, context = [] }) {
  const wav = wavInfo(bytes);
  const id = crypto.randomUUID();
  const storagePath = `${userId}/${machineId}/${id}.wav`;
  const { error: rError } = await db.from("recordings").insert({
    id,
    machine_id: machineId,
    kind,
    storage_path: storagePath,
    original_filename: path.basename(filename),
    size_bytes: bytes.length,
    duration_seconds: wav.durationSeconds,
    sample_rate_hz: wav.sampleRateHz,
    channels: wav.channels,
    recorded_at: null,
  });
  if (rError) die(`Could not save ${filename}: ${rError.message}`);
  const { error: uError } = await db.storage
    .from(BUCKET)
    .upload(storagePath, new Blob([bytes], { type: "audio/wav" }), { contentType: "audio/wav", upsert: false });
  if (uError) die(`Could not upload ${filename}: ${uError.message}`);
  if (context.length > 0) {
    const { error: cError } = await db.from("context_readings").insert(context.map((c) => ({ ...c, recording_id: id })));
    if (cError) die(`Could not save context for ${filename}: ${cError.message}`);
  }
  return id;
}

// Asks the inference service to analyse a recording, then reads back the stored decision.
// The service rate-limits analyses per user (429 with Retry-After); wait and retry.
export async function analyse(db, inferenceUrl, token, recordingId, filename) {
  let res;
  let body;
  for (let attempt = 0; attempt < 6; attempt++) {
    res = await fetch(`${inferenceUrl}/v1/analyses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ recording_id: recordingId }),
    });
    body = await res.json().catch(() => null);
    if (res.status !== 429) break;
    const wait = Number(res.headers.get("retry-after")) || 30;
    console.log(`  rate limited; waiting ${wait} s`);
    await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
  }
  if (!res.ok) die(`Analysis of ${filename} failed (${res.status}): ${body?.error?.message ?? "unknown"}`);
  const { data: pred } = await db
    .from("predictions")
    .select("decision")
    .eq("recording_id", recordingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return pred?.decision ?? "?";
}
