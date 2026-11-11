// One-command local test data: real MIMII DG clips, two machines with 10
// baselines each, real analyses, and set-aside files for manual uploads.
//
//   npm run seed:test-data            # download what is needed, seed if not seeded yet
//   npm run seed:test-data -- --reset # replace the test account's machines (nothing else)
//
// 1. Fetches only the clips it needs from MIMII DG (Zenodo 6529888, v1.0,
//    CC BY 4.0) into data/raw/mimii_dg_subset/ (git-ignored), by HTTP range
//    requests with a CRC-32 check, or copies them from data/raw/mimii_dg if the
//    full dataset is prepared. All clips: section 00, source domain, `test`
//    split (unseen by the model), 16 kHz mono 10 s, labelled normal / anomaly by
//    the dataset. MIMII DG has real bearing and gearbox recordings, the app's two
//    supported machine types, so nothing is relabelled.
// 2. Signs up / signs in testdata@sonovate.test (local stack only) and creates
//    one bearing and one gearbox machine with 10 normal baselines each.
// 3. Uploads separate analysis recordings and asks the inference service to
//    analyse each one; the service sets the baseline threshold and stores the
//    result. Nothing writes scores, thresholds or decisions directly.
// 4. Writes further clips, never uploaded, to data/interim/manual_uploads/ for
//    manual uploads through the UI, with a MANIFEST.json of their dataset labels.
//
// 60 s files join six different 10 s clips of the same label from the same
// section (MIMII DG has no 60 s recordings), so they can span operating
// settings (speed or voltage); no clip is looped or repeated (ADR-012, as in
// seed:demo). Every clip is used once: baselines, analyses and manual
// files never share a clip. Clips are drawn with a fixed seed, before any result
// is seen, so reruns pick the same files.
//
// Idempotent: if the test account already holds both machines with their
// baselines and analyses, it only refreshes the manual files. Only the
// dedicated test account is ever changed; refuses to run against non-local hosts.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureClips, testClipNames, ZENODO_RECORD } from "./mimii-subset.mjs";
import {
  analyse,
  deleteMachines,
  die,
  joinClips,
  localStack,
  requireInference,
  shuffled,
  signIn,
  uploadRecording,
  wavInfo,
} from "./seed-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

const FULL_DATA_DIR = process.env.SONOVATE_DEMO_DATA_DIR ?? path.join(repoRoot, "data/raw/mimii_dg");
const CACHE_DIR = path.join(repoRoot, "data/raw/mimii_dg_subset");
const MANUAL_DIR = path.join(repoRoot, "data/interim/manual_uploads");
// Local-only test credentials, like the seeded tech@sonovate.test user.
const EMAIL = process.env.SONOVATE_TEST_DATA_EMAIL ?? "testdata@sonovate.test";
const PASSWORD = process.env.SONOVATE_TEST_DATA_PASSWORD ?? "local-test-data-password-1";
const RESET = process.argv.includes("--reset");

const BASELINES = 10;
// Analysed by this script, in this order; the newest results decide the machine
// alert (2 of the last 3 above the threshold). "60:x" joins six clips of label x.
const CHECKS = ["normal", "normal", "60:normal", "anomaly", "60:anomaly", "anomaly"];
// Written to disk for manual uploads, never uploaded by this script.
const MANUAL = ["normal", "normal", "60:normal", "anomaly", "anomaly", "60:anomaly"];

const NOTE =
  "Test data from the public MIMII DG dataset (Zenodo 6529888, CC BY 4.0): section 00, source domain, test split " +
  "(unseen by the model). Baselines and checks come from the same recording session. File names carry the dataset " +
  "label (normal, or anomaly = a deliberately damaged machine); 60 s checks join six separate clips of one label. " +
  "Clips drawn at random (fixed seed) before any result was seen. Results are real model outputs, not an evaluation.";

const PLAN = [
  { name: "Test data · Bearing (MIMII DG)", type: "bearing", location: "Test bench · Bearing", seed: 11,
    context: (f) => [{ name: "speed", value: Number(/vel_([\d.]+)\.wav$/.exec(f)[1]), unit: "krpm" }] },
  { name: "Test data · Gearbox (MIMII DG)", type: "gearbox", location: "Test bench · Gearbox", seed: 12,
    context: (f) => [{ name: "voltage", value: Number(/volt_([\d.]+)\.wav$/.exec(f)[1]), unit: "V" }] },
];

const count = (list, label) => list.reduce((n, c) => n + (c.endsWith(label) ? (c.startsWith("60:") ? 6 : 1) : 0), 0);

// Fixed draw of every clip a machine needs: baselines, checks, manual files.
async function draw(plan) {
  const listing = await testClipNames(plan.type, FULL_DATA_DIR);
  const pick = (label) => {
    const re = new RegExp(`^section_00_source_test_${label}_\\d{4}_.+\\.wav$`);
    return shuffled(listing.names.filter((n) => re.test(n)), plan.seed);
  };
  const pools = { normal: pick("normal"), anomaly: pick("anomaly") };
  const needed = {
    normal: BASELINES + count(CHECKS, "normal") + count(MANUAL, "normal"),
    anomaly: count(CHECKS, "anomaly") + count(MANUAL, "anomaly"),
  };
  for (const label of ["normal", "anomaly"]) {
    if (pools[label].length < needed[label]) {
      die(`Only ${pools[label].length} ${plan.type} ${label} clips in section 00 source test; ${needed[label]} needed.`);
    }
  }
  const names = [...pools.normal.slice(0, needed.normal), ...pools.anomaly.slice(0, needed.anomaly)];
  const fetched = await ensureClips(plan.type, names, { fullDataDir: FULL_DATA_DIR, cacheDir: CACHE_DIR, listing });
  const where = new Map(names.map((n, i) => [n, fetched.paths[i]]));
  const queue = { normal: pools.normal.slice(0, needed.normal), anomaly: pools.anomaly.slice(0, needed.anomaly) };
  const take = (label, n) => queue[label].splice(0, n).map((name) => where.get(name));
  // Each recording: a single clip path, or a list of six clip paths to join.
  const items = (list, prefix) => {
    const index = { normal: 0, anomaly: 0 };
    return list.map((c) => {
      const long = c.startsWith("60:");
      const label = long ? c.slice(3) : c;
      const n = String(++index[label]).padStart(2, "0");
      const clips = take(label, long ? 6 : 1);
      const name = long
        ? `${prefix}_${plan.type}_${label}_60s_${n}_joined.wav`
        : `${prefix}_${plan.type}_${label}_10s_${n}__${path.basename(clips[0])}`;
      return { label, seconds: long ? 60 : 10, clips, name };
    });
  };
  const baselines = take("normal", BASELINES);
  const checks = items(CHECKS, "test");
  const manual = items(MANUAL, "manual");
  console.log(
    `${plan.type}: ${names.length} clips (${fetched.downloaded} downloaded from Zenodo, ${fetched.copied} copied from ` +
      `the local dataset, ${fetched.cached} already cached)`,
  );
  return { baselines, checks, manual };
}

async function bytesOf(item) {
  if (item.clips.length === 1) return readFile(item.clips[0]);
  return joinClips(await Promise.all(item.clips.map((c) => readFile(c))));
}

async function writeManualFiles(plan, manual) {
  const dir = path.join(MANUAL_DIR, plan.type);
  await mkdir(dir, { recursive: true });
  const entries = [];
  for (const item of manual) {
    const sourceNames = item.clips.map((c) => path.basename(c));
    const file = item.name;
    const bytes = await bytesOf(item);
    const wav = wavInfo(bytes);
    await writeFile(path.join(dir, file), bytes);
    entries.push({
      file: path.join(dir, file),
      machine: plan.name,
      dataset_label: item.label,
      duration_seconds: Number(wav.durationSeconds.toFixed(2)),
      sample_rate_hz: wav.sampleRateHz,
      channels: wav.channels,
      size_bytes: bytes.length,
      source_clips: sourceNames,
    });
  }
  return entries;
}

// Already seeded if both machines exist with exactly 10 baselines and every check analysed.
async function seededState(db) {
  const { data: machines, error } = await db.from("machines").select("id, name");
  if (error) die(`Could not list machines: ${error.message}`);
  const expected = new Set(PLAN.map((p) => p.name));
  const ours = machines.filter((m) => expected.has(m.name));
  if (machines.length === 0) return { machines, complete: false };
  if (ours.length !== PLAN.length || machines.length !== PLAN.length) return { machines, complete: false };
  for (const m of ours) {
    const { count: baselines } = await db
      .from("recordings").select("id", { count: "exact", head: true }).eq("machine_id", m.id).eq("kind", "baseline");
    const { data: analysed } = await db
      .from("recordings").select("id, predictions!inner(id)").eq("machine_id", m.id).eq("kind", "analysis");
    if (baselines !== BASELINES || (analysed ?? []).length < CHECKS.length) return { machines, complete: false };
  }
  return { machines, complete: true };
}

async function summary(db) {
  const rows = [];
  for (const plan of PLAN) {
    const { data: m } = await db.from("machines").select("id").eq("name", plan.name).single();
    const { count: baselines } = await db
      .from("recordings").select("id", { count: "exact", head: true }).eq("machine_id", m.id).eq("kind", "baseline");
    const { data: preds } = await db
      .from("predictions").select("decision, recordings!inner(machine_id)").eq("recordings.machine_id", m.id);
    const above = (preds ?? []).filter((p) => p.decision === "above_threshold").length;
    rows.push({ machine: plan.name, baselines, analyses: (preds ?? []).length, above_threshold: above });
  }
  return rows;
}

async function main() {
  const stack = await localStack("seed:test-data");
  await requireInference(stack.inferenceUrl);

  console.log(`MIMII DG v1.0 (${ZENODO_RECORD}, CC BY 4.0): preparing the clips`);
  const draws = new Map();
  for (const plan of PLAN) draws.set(plan, await draw(plan));

  const { db, userId, token } = await signIn(stack, EMAIL, PASSWORD);
  const state = await seededState(db);
  const results = [];
  if (state.complete && !RESET) {
    console.log("\nTest machines are already seeded; nothing uploaded or analysed. Use --reset to replace them.");
  } else {
    if (state.machines.length > 0 && !RESET) {
      die(
        `${EMAIL} has ${state.machines.length} machine(s) that do not match a finished seed. ` +
          "Re-run with --reset to replace them (only this test account is changed).",
      );
    }
    await deleteMachines(db, userId, state.machines);

    for (const plan of PLAN) {
      const { baselines, checks } = draws.get(plan);
      const { data: machine, error } = await db
        .from("machines")
        .insert({ name: plan.name, machine_type: plan.type, location: plan.location, notes: NOTE })
        .select()
        .single();
      if (error) die(`Could not create ${plan.name}: ${error.message}`);
      console.log(`\n${plan.name}`);

      for (const clip of baselines) {
        const filename = path.basename(clip);
        await uploadRecording(db, userId, machine.id, {
          filename, bytes: await readFile(clip), kind: "baseline", context: plan.context(filename),
        });
      }
      console.log(`  ${baselines.length} baseline recordings uploaded`);

      for (const item of checks) {
        const filename = item.seconds === 60 ? item.name : path.basename(item.clips[0]);
        const recordingId = await uploadRecording(db, userId, machine.id, {
          filename,
          bytes: await bytesOf(item),
          kind: "analysis",
          context: item.seconds === 60 ? [] : plan.context(filename),
        });
        const decision = await analyse(db, stack.inferenceUrl, token, recordingId, filename);
        results.push({ machine: plan.name, file: filename, dataset_label: item.label, seconds: item.seconds, model_decision: decision });
        console.log(`  analysed ${filename} → ${decision}`);
      }
    }
    console.log("\nAnalyses run now (dataset label vs. model decision; not an evaluation):");
    console.table(results);
  }

  const manual = [];
  for (const plan of PLAN) manual.push(...(await writeManualFiles(plan, draws.get(plan).manual)));
  await writeFile(
    path.join(MANUAL_DIR, "MANIFEST.json"),
    JSON.stringify(
      {
        dataset: "MIMII DG v1.0, section 00 source domain, test split",
        source: ZENODO_RECORD,
        license: "CC BY 4.0 (attribution: Dohi et al., MIMII DG, arXiv:2205.13879)",
        note: "dataset_label is the dataset's ground truth, not a model prediction. 60 s files join six separate clips.",
        files: manual,
      },
      null,
      2,
    ) + "\n",
  );

  console.log("\nTest machines:");
  console.table(await summary(db));
  console.log(`\nFiles for manual uploads (never uploaded by this script), listed in ${path.join(MANUAL_DIR, "MANIFEST.json")}:`);
  console.table(manual.map((m) => ({ machine: m.machine, dataset_label: m.dataset_label, seconds: m.duration_seconds, file: path.relative(repoRoot, m.file) })));
  console.log(`\nDone. Sign in at http://localhost:3000/login as ${EMAIL} (password in frontend/scripts/seed-test-data.mjs).`);
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
