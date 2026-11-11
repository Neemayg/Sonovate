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

import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
} from "./seed-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

const DATA_DIR = process.env.SONOVATE_DEMO_DATA_DIR ?? path.join(repoRoot, "data/raw/mimii_dg");
// Local-only demo credentials, like the seeded tech@sonovate.test user.
const EMAIL = process.env.SONOVATE_DEMO_EMAIL ?? "demo@sonovate.test";
const PASSWORD = process.env.SONOVATE_DEMO_PASSWORD ?? "local-demo-password-1";
const RESET = process.argv.includes("--reset");

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

async function pool(folder, label, seed) {
  const dir = path.join(DATA_DIR, folder, "test");
  const pattern = new RegExp(`^section_00_source_test_${label}_\\d{4}_.+\\.wav$`);
  const files = (await readdir(dir)).filter((f) => pattern.test(f)).sort();
  if (files.length < 40) die(`Only ${files.length} ${label} test clips for ${folder} in ${dir}.`);
  return shuffled(files, seed).map((f) => path.join(dir, f));
}

async function main() {
  const stack = await localStack("seed:demo");
  if (!(await access(DATA_DIR).then(() => true, () => false))) {
    die(`MIMII DG data not found at ${DATA_DIR}. Prepare it (CLAUDE.md), set SONOVATE_DEMO_DATA_DIR, or use npm run seed:test-data.`);
  }
  await requireInference(stack.inferenceUrl);

  // 1. account
  const { db, userId, token } = await signIn(stack, EMAIL, PASSWORD);

  // Existing data: stop, or delete with --reset (same steps as deleteMachine).
  const { data: existing, error: listError } = await db.from("machines").select("id, name");
  if (listError) die(`Could not list machines: ${listError.message}`);
  if (existing.length > 0 && !RESET) {
    die(`${EMAIL} already has ${existing.length} machine(s). Re-run with --reset to replace them.`);
  }
  await deleteMachines(db, userId, existing);

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
      const single = typeof source === "string";
      return uploadRecording(db, userId, machine.id, {
        filename: single ? path.basename(source) : source.name,
        bytes: single ? await readFile(source) : source.bytes,
        kind,
        context: single ? plan.context(source) : [],
      });
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
        source = { name: `demo_60s_${label}_joined_${++joined}.wav`, bytes: joinClips(parts) };
      } else {
        source = take(label, 1)[0];
      }
      const file = typeof source === "string" ? path.basename(source) : source.name;
      const recordingId = await upload(source, "analysis");
      const decision = await analyse(db, stack.inferenceUrl, token, recordingId, file);
      results.push({ machine: plan.name, clip: file, label: long ? `${label} (60 s)` : label, decision });
      console.log(`  analysed ${file} → ${decision}`);
    }
  }

  console.log("\nDemo results (dataset label vs. model decision):");
  console.table(results);
  console.log(`\nDone. Sign in at http://localhost:3000/login as ${EMAIL}.`);
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
