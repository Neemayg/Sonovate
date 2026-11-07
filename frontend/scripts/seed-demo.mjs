// Seeds a LOCAL demo account with real recordings for presentations.
//
//   npm run seed:demo            # create the demo account and its machines
//   npm run seed:demo -- --reset # delete the demo account's machines first
//
// What it does, through the same paths the app uses (the demo user's own
// session, so row-level security applies):
//   1. signs up or signs in demo@sonovate.test (local stack only),
//   2. creates demo machines and uploads real clips from the public MIMII DG
//      dataset (CC BY 4.0) in data/raw/mimii_dg: training-set normal clips as
//      baselines, labelled test clips (normal / anomaly) as new recordings,
//      with the operating condition read from each filename,
//   3. asks the inference service to analyse every test recording.
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

const DEMO_NOTE = (condition) =>
  `Demo data from the public MIMII DG dataset (CC BY 4.0), section 00, operating condition ${condition}. ` +
  "Baselines are training-set normal clips; test filenames say whether a clip is normal or from a deliberately " +
  "damaged machine. Results are real model outputs on these clips, not an evaluation.";

// The demo machines. Tests run in this order, so the newest results decide
// the machine alert (2 of the last 3 above the threshold).
const PLAN = [
  {
    name: "Demo · Gearbox, line 2",
    type: "gearbox",
    folder: "gearbox",
    condition: "volt_2.0",
    location: "Demo plant · Line 2",
    context: (file) => [{ name: "voltage", value: Number(/volt_([\d.]+)\.wav$/.exec(file)[1]), unit: "V" }],
    baselines: 10,
    tests: ["normal", "normal", "anomaly", "anomaly", "anomaly"],
  },
  {
    name: "Demo · Pump bearing",
    type: "bearing",
    folder: "bearing",
    condition: "vel_14",
    location: "Demo plant · Pump room",
    context: (file) => [{ name: "speed", value: Number(/vel_([\d.]+)\.wav$/.exec(file)[1]), unit: "krpm" }],
    baselines: 10,
    tests: ["normal", "anomaly", "normal", "anomaly"],
  },
  {
    name: "Demo · Conveyor bearing (new)",
    type: "bearing",
    folder: "bearing",
    condition: "vel_10",
    location: "Demo plant · Conveyor",
    context: (file) => [{ name: "speed", value: Number(/vel_([\d.]+)\.wav$/.exec(file)[1]), unit: "krpm" }],
    baselines: 4, // deliberately short of 10, to show the "needs baseline" state
    tests: [],
  },
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

async function pickClips(folder, split, label, condition, count) {
  const dir = path.join(DATA_DIR, folder, split);
  const pattern = new RegExp(`^section_00_source_${split}_${label}_\\d{4}_${condition.replace(".", "\\.")}\\.wav$`);
  const files = (await readdir(dir)).filter((f) => pattern.test(f)).sort();
  if (files.length < count) die(`Only ${files.length} ${label} ${split} clips for ${folder} ${condition} in ${dir}.`);
  return files.slice(0, count).map((f) => path.join(dir, f));
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
      .insert({ name: plan.name, machine_type: plan.type, location: plan.location, notes: DEMO_NOTE(plan.condition) })
      .select()
      .single();
    if (mError) die(`Could not create ${plan.name}: ${mError.message}`);
    console.log(`\n${plan.name}`);

    const upload = async (file, kind) => {
      const bytes = await readFile(file);
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
      const context = plan.context(file).map((c) => ({ ...c, recording_id: id }));
      const { error: cError } = await db.from("context_readings").insert(context);
      if (cError) die(`Could not save context for ${path.basename(file)}: ${cError.message}`);
      return id;
    };

    for (const file of await pickClips(plan.folder, "train", "normal", plan.condition, plan.baselines)) {
      await upload(file, "baseline");
    }
    console.log(`  ${plan.baselines} baseline recordings uploaded`);

    const counters = { normal: 0, anomaly: 0 };
    const needed = { normal: 0, anomaly: 0 };
    for (const label of plan.tests) needed[label] += 1;
    const pools = {
      normal: needed.normal ? await pickClips(plan.folder, "test", "normal", plan.condition, needed.normal) : [],
      anomaly: needed.anomaly ? await pickClips(plan.folder, "test", "anomaly", plan.condition, needed.anomaly) : [],
    };
    for (const label of plan.tests) {
      const file = pools[label][counters[label]++];
      const recordingId = await upload(file, "analysis");
      const res = await fetch(`${INFERENCE_URL}/v1/analyses`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ recording_id: recordingId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) die(`Analysis of ${path.basename(file)} failed (${res.status}): ${body?.error?.message ?? "unknown"}`);
      const { data: pred } = await db
        .from("predictions")
        .select("decision")
        .eq("recording_id", recordingId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      results.push({ machine: plan.name, clip: path.basename(file), label, decision: pred?.decision ?? "?" });
      console.log(`  analysed ${path.basename(file)} → ${pred?.decision ?? "?"}`);
    }
  }

  console.log("\nDemo results (dataset label vs. model decision):");
  console.table(results);
  console.log(`\nDone. Sign in at http://localhost:3000/login as ${EMAIL}.`);
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
