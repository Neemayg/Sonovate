// Seeds a LOCAL demo account with real recordings for presentations.
//
//   npm run seed:demo            # create the demo account and its machines
//   npm run seed:demo -- --reset # delete the demo account's machines first
//
// What it does, through the same paths the app uses (the demo user's own
// session, so row-level security applies):
//   1. signs up or signs in demo@sonovate.test (local stack only),
//   2. creates demo machines and uploads real clips from the public MIMII DG
//      dataset (CC BY 4.0) in data/raw/mimii_dg, all from section 00 source of
//      the `test` split (unseen by every model) so baselines and checks share a
//      recording session, as in the app: normal clips as baselines, labelled
//      normal / anomaly clips as checks, plus one 60 s normal and one 60 s
//      anomaly check made by joining six separate clips (ADR-012). Clips are
//      drawn with a fixed seed before any result is seen,
//   3. asks the inference service to analyse every check.
// Every stored result is the real model output for that clip. Nothing is
// invented. Demo results are not an evaluation (see docs/EXPERIMENT_LOG.md).
//
// Refuses to run against anything but loopback hosts.

import { createClient } from "@supabase/supabase-js";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const INFERENCE_URL = process.env.NEXT_PUBLIC_INFERENCE_API_URL ?? "";
const DATA_DIR = process.env.SONOVATE_DEMO_DATA_DIR ?? path.join(repoRoot, "data/raw/mimii_dg");
// Local-only demo credentials, like the seeded tech@sonovate.test user.
const EMAIL = process.env.SONOVATE_DEMO_EMAIL ?? "demo@sonovate.test";
const PASSWORD = process.env.SONOVATE_DEMO_PASSWORD ?? "local-demo-password-1";
const RESET = process.argv.includes("--reset");
const BUCKET = "recordings";

const DEMO_NOTE =
  "Demo data from the public MIMII DG dataset (CC BY 4.0), section 00 source, test split (unseen by the model). " +
  "Baselines and checks come from the same recording session. File names say whether a clip is normal or from a " +
  "deliberately damaged machine; the 60 s checks join six separate clips of one label. Clips were drawn at random " +
  "(fixed seed) before any result was seen. Results are real model outputs, not an evaluation.";

const SPEED = (file) => [{ name: "speed", value: Number(/vel_([\d.]+)\.wav$/.exec(file)[1]), unit: "krpm" }];
const VOLTAGE = (file) => [{ name: "voltage", value: Number(/volt_([\d.]+)\.wav$/.exec(file)[1]), unit: "V" }];

// The demo machines. Checks run in this order, so the newest results decide the
// machine alert (2 of the last 3 above the threshold). "60:normal" is a 60 s
// recording joined from six normal clips.
const CHECKS = ["normal", "normal", "60:normal", "anomaly", "60:anomaly", "anomaly"];
const PLAN = [
  { name: "Demo · Gearbox, line 2", type: "gearbox", folder: "gearbox", location: "Demo plant · Line 2",
    context: VOLTAGE, baselines: 30, checks: CHECKS, seed: 1 },
  { name: "Demo · Pump bearing", type: "bearing", folder: "bearing", location: "Demo plant · Pump room",
    context: SPEED, baselines: 30, checks: CHECKS, seed: 2 },
  // Deliberately short of 10 baselines, to show the "needs baseline" state.
  { name: "Demo · Conveyor bearing (new)", type: "bearing", folder: "bearing", location: "Demo plant · Conveyor",
    context: SPEED, baselines: 4, checks: [], seed: 3 },
];

function die(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function isLoopback(url) {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

// Minimal WAV header read, mirroring src/lib/wav.ts; the service re-checks.
function wavInfo(buf) {
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
function shuffled(items, seed) {
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

async function pool(folder, label, seed) {
  const dir = path.join(DATA_DIR, folder, "test");
  const pattern = new RegExp(`^section_00_source_test_${label}_\\d{4}_.+\\.wav$`);
  const files = (await readdir(dir)).filter((f) => pattern.test(f)).sort();
  if (files.length < 40) die(`Only ${files.length} ${label} test clips for ${folder} in ${dir}.`);
  return shuffled(files, seed).map((f) => path.join(dir, f));
}

// PCM bytes of a WAV's data chunk (the clips are 16 kHz mono 16-bit).
function pcm(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let pos = 12; pos + 8 <= buf.length; ) {
    const id = String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]);
    const size = view.getUint32(pos + 4, true);
    if (id === "data") return buf.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

function wavBytes(data) {
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

async function main() {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !INFERENCE_URL) {
    die("Missing NEXT_PUBLIC_* settings. Run with: npm run seed:demo (it reads frontend/.env.local).");
  }
  if (!isLoopback(SUPABASE_URL) || !isLoopback(INFERENCE_URL)) {
    die("The demo seeder only runs against a local stack (localhost / 127.0.0.1).");
  }
  if (!(await access(DATA_DIR).then(() => true, () => false))) {
    die(`MIMII DG data not found at ${DATA_DIR}. Prepare it (CLAUDE.md) or set SONOVATE_DEMO_DATA_DIR.`);
  }
  const health = await fetch(`${INFERENCE_URL}/v1/health`).catch(() => null);
  if (!health?.ok) die(`The inference service is not reachable at ${INFERENCE_URL}. Start it first (backend/README.md).`);

  const db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });

  // 1. account
  let { data: auth, error } = await db.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) {
    const signUp = await db.auth.signUp({ email: EMAIL, password: PASSWORD });
    if (signUp.error) die(`Could not create ${EMAIL}: ${signUp.error.message}`);
    ({ data: auth, error } = await db.auth.signInWithPassword({ email: EMAIL, password: PASSWORD }));
    if (error) die(`Could not sign in as ${EMAIL}: ${error.message}`);
    console.log(`Created demo account ${EMAIL}`);
  } else {
    console.log(`Signed in as ${EMAIL}`);
  }
  const userId = auth.user.id;
  const token = auth.session.access_token;

  // Existing data: stop, or delete with --reset (same steps as deleteMachine).
  const { data: existing, error: listError } = await db.from("machines").select("id, name");
  if (listError) die(`Could not list machines: ${listError.message}`);
  if (existing.length > 0 && !RESET) {
    die(`${EMAIL} already has ${existing.length} machine(s). Re-run with --reset to replace them.`);
  }
  for (const m of existing) {
    const folder = `${userId}/${m.id}`;
    const { data: objects } = await db.storage.from(BUCKET).list(folder, { limit: 1000 });
    const paths = (objects ?? []).map((o) => `${folder}/${o.name}`);
    if (paths.length > 0) await db.storage.from(BUCKET).remove(paths);
    const { error: delError } = await db.from("machines").delete().eq("id", m.id);
    if (delError) die(`Could not delete ${m.name}: ${delError.message}`);
    console.log(`Deleted ${m.name}`);
  }

  // 2 + 3. machines, recordings, analyses
  const results = [];
  for (const plan of PLAN) {
    const { data: machine, error: mError } = await db
      .from("machines")
      .insert({ name: plan.name, machine_type: plan.type, location: plan.location, notes: DEMO_NOTE })
      .select()
      .single();
    if (mError) die(`Could not create ${plan.name}: ${mError.message}`);
    console.log(`\n${plan.name}`);

    // `source` is a clip path, or { name, bytes } for a joined 60 s recording (no single operating setting).
    const upload = async (source, kind) => {
      const file = typeof source === "string" ? source : source.name;
      const bytes = typeof source === "string" ? await readFile(source) : source.bytes;
      const wav = wavInfo(bytes);
      const id = crypto.randomUUID();
      const storagePath = `${userId}/${machine.id}/${id}.wav`;
      const { error: rError } = await db.from("recordings").insert({
        id,
        machine_id: machine.id,
        kind,
        storage_path: storagePath,
        original_filename: path.basename(file),
        size_bytes: bytes.length,
        duration_seconds: wav.durationSeconds,
        sample_rate_hz: wav.sampleRateHz,
        channels: wav.channels,
        recorded_at: null,
      });
      if (rError) die(`Could not save ${path.basename(file)}: ${rError.message}`);
      const { error: uError } = await db.storage
        .from(BUCKET)
        .upload(storagePath, new Blob([bytes], { type: "audio/wav" }), { contentType: "audio/wav", upsert: false });
      if (uError) die(`Could not upload ${path.basename(file)}: ${uError.message}`);
      if (typeof source === "string") {
        const context = plan.context(file).map((c) => ({ ...c, recording_id: id }));
        const { error: cError } = await db.from("context_readings").insert(context);
        if (cError) die(`Could not save context for ${path.basename(file)}: ${cError.message}`);
      }
      return id;
    };

    const pools = { normal: await pool(plan.folder, "normal", plan.seed), anomaly: await pool(plan.folder, "anomaly", plan.seed) };
    const take = (label, n) => pools[label].splice(0, n);
    for (const file of take("normal", plan.baselines)) await upload(file, "baseline");
    console.log(`  ${plan.baselines} baseline recordings uploaded`);

    let joined = 0;
    for (const check of plan.checks) {
      const long = check.startsWith("60:");
      const label = long ? check.slice(3) : check;
      let source;
      if (long) {
        const parts = await Promise.all(take(label, 6).map((f) => readFile(f)));
        source = { name: `demo_60s_${label}_joined_${++joined}.wav`, bytes: wavBytes(Buffer.concat(parts.map(pcm))) };
      } else {
        source = take(label, 1)[0];
      }
      const file = typeof source === "string" ? source : source.name;
      const recordingId = await upload(source, "analysis");
      // The service rate-limits analyses per user (429 with Retry-After); wait and retry instead of failing.
      let res;
      let body;
      for (let attempt = 0; attempt < 6; attempt++) {
        res = await fetch(`${INFERENCE_URL}/v1/analyses`, {
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
      if (!res.ok) die(`Analysis of ${path.basename(file)} failed (${res.status}): ${body?.error?.message ?? "unknown"}`);
      const { data: pred } = await db
        .from("predictions")
        .select("decision")
        .eq("recording_id", recordingId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      results.push({ machine: plan.name, clip: path.basename(file), label: long ? `${label} (60 s)` : label, decision: pred?.decision ?? "?" });
      console.log(`  analysed ${path.basename(file)} → ${pred?.decision ?? "?"}`);
    }
  }

  console.log("\nDemo results (dataset label vs. model decision):");
  console.table(results);
  console.log(`\nDone. Sign in at http://localhost:3000/login as ${EMAIL}.`);
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
