// The single client module for all data access: Supabase (auth, tables,
// storage) and the inference service. Pages must not call either directly.
//
// Only the publishable key is used here. Row-level security in Supabase
// decides what the signed-in user can read and write.

import { createClient, type Session } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { WavInfo } from "./wav";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const INFERENCE_API_URL = process.env.NEXT_PUBLIC_INFERENCE_API_URL ?? "";
const BUCKET = "recordings";

type Tables = Database["public"]["Tables"];
export type Machine = Tables["machines"]["Row"];
export type Recording = Tables["recordings"]["Row"];
export type ContextReading = Tables["context_readings"]["Row"];
export type RecordingKind = Database["public"]["Enums"]["recording_kind"];
export type MachineInput = Pick<Machine, "name" | "machine_type" | "location" | "notes" | "sensitivity">;

// ADR-014 (EXP-032): the machine's threshold setting. Figures are held-out lab
// results with 10 baselines (about 9% vs 13-19% of normal recordings flagged;
// 1.4-1.6x as many anomalies caught).
export type Sensitivity = "standard" | "high";
export const SENSITIVITY_OPTIONS: { value: Sensitivity; label: string; help: string }[] = [
  {
    value: "standard",
    label: "Standard (recommended)",
    help: "Fewer false alarms: about 1 in 11 normal recordings is flagged. Misses more problems.",
  },
  {
    value: "high",
    label: "High sensitivity",
    help: "Catches about 1.5 times as many problems in lab tests, but flags more normal recordings: about 1 in 6. Expect more machine alerts that turn out to be nothing.",
  },
];

export function sensitivityLabel(value: string | null | undefined): string {
  return value === "high" ? "High sensitivity" : "Standard";
}
export type ContextInput = { name: string; value: number; unit: string };

export type Prediction = Tables["predictions"]["Row"] & {
  model_versions: Pick<
    Tables["model_versions"]["Row"],
    "name" | "version" | "preprocessing_version" | "machine_type" | "limitations"
  > | null;
};

// Minimum baseline recordings before results are shown (ADR-007, EXP-005).
export const BASELINE_REQUIRED = 10;
// Recommended baseline recordings: more baselines catch more anomalies at the
// same false-alarm level (ADR-011; EXP-012, EXP-017, EXP-020). Not enforced.
export const BASELINE_RECOMMENDED = 30;

export type RecordingDetail = Recording & {
  machines: Pick<Machine, "id" | "name" | "machine_type"> | null;
  context_readings: ContextReading[];
};

export type HistoryEntry = Recording & {
  context_readings: ContextReading[];
  predictions: Prediction[];
};

let client: ReturnType<typeof createClient<Database>> | null = null;

function supabase() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "Frontend is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  // PKCE: OAuth redirects come back with a one-time ?code= that the client
  // exchanges itself (detectSessionInUrl), instead of tokens in the URL.
  client ??= createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { flowType: "pkce" },
  });
  return client;
}

// Server-side caps (supabase migration deploy_hardening) raise these codes.
function capMessage(error: { message?: string } | null): string | null {
  if (error?.message === "baseline_limit_reached") {
    return "This machine already has 50 baseline recordings, the maximum. Delete one before adding another.";
  }
  if (error?.message === "recording_limit_reached") {
    return "Your account has reached 500 recordings, the maximum. Delete some before uploading more.";
  }
  return null;
}

function fail(message: string, error: unknown): never {
  // Supabase errors can be technical; keep the user-facing text plain.
  console.error(message, error);
  throw new Error(message);
}

// --- auth -------------------------------------------------------------------

// Set when Supabase Auth requires CAPTCHA (production). The token comes from
// the Turnstile widget on the login page and is checked by Supabase.
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export async function signIn(email: string, password: string, captchaToken?: string): Promise<void> {
  const { error } = await supabase().auth.signInWithPassword({ email, password, options: { captchaToken } });
  if (error) throw new Error(error.message);
}

export async function signUp(
  email: string,
  password: string,
  captchaToken?: string,
): Promise<{ needsConfirmation: boolean }> {
  const { data, error } = await supabase().auth.signUp({ email, password, options: { captchaToken } });
  if (error) throw new Error(error.message);
  return { needsConfirmation: data.session === null };
}

// Asks Supabase Auth which sign-in providers are switched on, so the UI only
// offers Google when the local stack has been configured for it.
export async function isGoogleSignInEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
    });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.external?.google === true;
  } catch {
    return false;
  }
}

// Redirects the browser to Google; Supabase sends it back to /auth/callback.
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase().auth.getSession();
  return data.session;
}

export function onAuthChange(callback: (session: Session | null) => void): () => void {
  const { data } = supabase().auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

async function requireUserId(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("You are signed out. Sign in again.");
  return session.user.id;
}

// --- machines ---------------------------------------------------------------

export type MachineOverview = Machine & {
  recordingCount: number;
  baselineCount: number;
  lastUploadAt: string | null;
  // The most recent stored result across the machine's recordings, if any.
  latest: { decision: string; created_at: string; recording_id: string } | null;
  // Latest stored decision of each analysis recording, newest last, at most RECENT_RESULTS.
  recent: { above: boolean; created_at: string; recording_id: string }[];
  alert: MachineAlert | null;
};

export const RECENT_RESULTS = 6;

// ADR-009: machine alert when at least 2 of the last 3 analysed recordings
// are above the machine's baseline threshold. Computed by the
// public.machine_alerts view (RLS applies through security_invoker).
export type MachineAlert = {
  analyses_considered: number;
  above_threshold_count: number;
  alert: boolean;
  last_analysed_at: string;
};

async function machineAlerts(machineId?: string): Promise<Map<string, MachineAlert>> {
  let query = supabase()
    .from("machine_alerts")
    .select("machine_id, analyses_considered, above_threshold_count, alert, last_analysed_at");
  if (machineId) query = query.eq("machine_id", machineId);
  const { data, error } = await query;
  if (error) fail("Could not load machine alerts.", error);
  return new Map(
    data.map((row) => [
      row.machine_id as string,
      {
        analyses_considered: row.analyses_considered ?? 0,
        above_threshold_count: row.above_threshold_count ?? 0,
        alert: row.alert === true,
        last_analysed_at: row.last_analysed_at ?? "",
      },
    ]),
  );
}

export async function getMachineAlert(machineId: string): Promise<MachineAlert | null> {
  return (await machineAlerts(machineId)).get(machineId) ?? null;
}

type OverviewRow = Machine & {
  recordings: {
    id: string;
    kind: RecordingKind;
    created_at: string;
    predictions: { decision: string; created_at: string }[];
  }[];
};

// Every machine with what the overview needs, in one request. Counts are
// worked out here; fine for a handful of machines, not for thousands.
export async function listMachineOverviews(): Promise<MachineOverview[]> {
  const { data, error } = await supabase()
    .from("machines")
    .select("*, recordings(id, kind, created_at, predictions(decision, created_at))")
    .order("created_at", { ascending: false });
  if (error) fail("Could not load machines.", error);
  const alerts = await machineAlerts();
  return (data as OverviewRow[]).map((row) => ({ ...summarise(row), alert: alerts.get(row.id) ?? null }));
}

export function summarise(row: Machine & Partial<Pick<OverviewRow, "recordings">>): MachineOverview {
  const { recordings = [], ...machine } = row;
  let latest: MachineOverview["latest"] = null;
  let lastUploadAt: string | null = null;
  const recent: MachineOverview["recent"] = [];
  for (const r of recordings) {
    if (r.kind === "analysis" && r.predictions.length > 0) {
      const p = r.predictions.reduce((a, b) => (b.created_at > a.created_at ? b : a));
      recent.push({ above: p.decision === "above_threshold", created_at: p.created_at, recording_id: r.id });
    }
    if (!lastUploadAt || r.created_at > lastUploadAt) lastUploadAt = r.created_at;
    for (const p of r.predictions) {
      if (!latest || p.created_at > latest.created_at) latest = { ...p, recording_id: r.id };
    }
  }
  return {
    ...machine,
    recordingCount: recordings.length,
    baselineCount: recordings.filter((r) => r.kind === "baseline").length,
    lastUploadAt,
    latest,
    recent: recent.sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-RECENT_RESULTS),
    alert: null,
  };
}

export async function getMachine(id: string): Promise<Machine | null> {
  const { data, error } = await supabase().from("machines").select("*").eq("id", id).maybeSingle();
  if (error) fail("Could not load this machine.", error);
  return data;
}

export async function createMachine(input: MachineInput): Promise<Machine> {
  const { data, error } = await supabase().from("machines").insert(input).select().single();
  if (error) fail("Could not create the machine.", error);
  return data;
}

export async function updateMachine(id: string, input: MachineInput): Promise<Machine> {
  const { data, error } = await supabase().from("machines").update(input).eq("id", id).select().single();
  if (error) fail("Could not save the machine.", error);
  return data;
}

// --- recordings -------------------------------------------------------------

export async function listRecordings(machineId: string): Promise<Recording[]> {
  const { data, error } = await supabase()
    .from("recordings")
    .select("*")
    .eq("machine_id", machineId)
    .order("created_at", { ascending: false });
  if (error) fail("Could not load recordings.", error);
  return data;
}

export async function getRecording(id: string): Promise<RecordingDetail | null> {
  const { data, error } = await supabase()
    .from("recordings")
    .select("*, machines(id, name, machine_type), context_readings(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) fail("Could not load this recording.", error);
  return data as RecordingDetail | null;
}

export type NewRecording = {
  machineId: string;
  file: File;
  wav: WavInfo;
  kind: RecordingKind;
  recordedAt: string | null;
  context: ContextInput[];
};

// Creates the row first (the storage policy only accepts a file for an
// existing row with the same path), then uploads, then adds context. Any
// failure removes what was already written.
export async function createRecording(input: NewRecording): Promise<Recording> {
  const ownerId = await requireUserId();
  const id = crypto.randomUUID();
  const storagePath = `${ownerId}/${input.machineId}/${id}.wav`;
  const db = supabase();

  const { data: row, error: rowError } = await db
    .from("recordings")
    .insert({
      id,
      machine_id: input.machineId,
      kind: input.kind,
      storage_path: storagePath,
      original_filename: input.file.name.slice(0, 255),
      size_bytes: input.file.size,
      duration_seconds: input.wav.durationSeconds,
      sample_rate_hz: input.wav.sampleRateHz,
      channels: input.wav.channels,
      recorded_at: input.recordedAt,
    })
    .select()
    .single();
  if (rowError) fail(capMessage(rowError) ?? "Could not save the recording.", rowError);

  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(storagePath, input.file, { contentType: "audio/wav", upsert: false });
  if (uploadError) {
    await db.from("recordings").delete().eq("id", id);
    fail("Could not upload the audio file.", uploadError);
  }

  if (input.context.length > 0) {
    const { error: ctxError } = await db
      .from("context_readings")
      .insert(input.context.map((c) => ({ ...c, recording_id: id })));
    if (ctxError) {
      await db.storage.from(BUCKET).remove([storagePath]);
      await db.from("recordings").delete().eq("id", id);
      fail("Could not save the operating context, so the upload was undone.", ctxError);
    }
  }
  return row;
}

// Downloads a recording's audio with the user's own session (Storage RLS
// applies), for playback and the waveform on the analysis page.
export async function downloadRecordingAudio(storagePath: string): Promise<Blob> {
  const { data, error } = await supabase().storage.from(BUCKET).download(storagePath);
  if (error) fail("Could not load the audio file.", error);
  return data;
}

// Supabase blocks deleting storage objects from SQL, so files are removed
// here, before the rows. If the row delete then fails, the row stays with
// no file and the delete can simply be retried (removing a missing file is
// a no-op). The other order could leave an orphaned file nobody can see.
async function removeFiles(paths: string[]): Promise<void> {
  const db = supabase();
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await db.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    if (error) fail("Could not delete the audio files.", error);
  }
}

// Deletes one recording: its audio file, then the row. Context readings
// and results go with the row (foreign-key cascade). Deleting a baseline
// changes the baseline set, so the machine's threshold is recomputed at its
// next analysis.
export async function deleteRecording(recording: Pick<Recording, "id" | "storage_path">): Promise<void> {
  await removeFiles([recording.storage_path]);
  const { data, error } = await supabase().from("recordings").delete().eq("id", recording.id).select("id");
  if (error) fail("Could not delete the recording.", error);
  if (data.length !== 1) throw new Error("Recording not found. It may already have been deleted.");
}

// Deletes a machine with everything under it: every file in its storage
// folder (including any left behind by an interrupted upload), then the
// machine row, which cascades to recordings, context, results and thresholds.
export async function deleteMachine(machineId: string): Promise<void> {
  const ownerId = await requireUserId();
  const db = supabase();
  const folder = `${ownerId}/${machineId}`;

  const { data: rows, error: rowsError } = await db
    .from("recordings")
    .select("storage_path")
    .eq("machine_id", machineId);
  if (rowsError) fail("Could not list the machine's recordings.", rowsError);
  const paths = new Set(rows.map((r) => r.storage_path));
  // Paginated: a machine can hold more files than one listing page returns.
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    const { data: objects, error: listError } = await db.storage.from(BUCKET).list(folder, { limit: page, offset });
    if (listError) fail("Could not list the machine's audio files.", listError);
    for (const object of objects) paths.add(`${folder}/${object.name}`);
    if (objects.length < page) break;
  }
  await removeFiles([...paths]);

  const { data, error } = await db.from("machines").delete().eq("id", machineId).select("id");
  if (error) fail("Could not delete the machine.", error);
  if (data.length !== 1) throw new Error("Machine not found. It may already have been deleted.");
}

// Every recording of a machine with its context and any stored predictions,
// newest first. Predictions exist only once a validated model is registered.
export async function listMachineHistory(machineId: string): Promise<HistoryEntry[]> {
  const { data, error } = await supabase()
    .from("recordings")
    .select(
      "*, context_readings(*), predictions(*, model_versions(name, version, preprocessing_version, machine_type, limitations))",
    )
    .eq("machine_id", machineId)
    .order("created_at", { ascending: false })
    .order("created_at", { referencedTable: "predictions", ascending: false });
  if (error) fail("Could not load the machine history.", error);
  return data as HistoryEntry[];
}

export async function listPredictions(recordingId: string): Promise<Prediction[]> {
  const { data, error } = await supabase()
    .from("predictions")
    .select("*, model_versions(name, version, preprocessing_version, machine_type, limitations)")
    .eq("recording_id", recordingId)
    .order("created_at", { ascending: false });
  if (error) fail("Could not load analysis results.", error);
  return data as Prediction[];
}

// --- dashboard ----------------------------------------------------------------

export type RecentAnalysis = {
  id: string;
  created_at: string;
  decision: string;
  score: number;
  log_score: number | null;
  threshold: number;
  baseline_count: number | null;
  recording_id: string;
  machine: Pick<Machine, "id" | "name" | "machine_type"> | null;
  model: { name: string; version: string } | null;
};

type RecentAnalysisRow = Omit<RecentAnalysis, "machine" | "model"> & {
  recordings: { machines: Pick<Machine, "id" | "name" | "machine_type"> | null } | null;
  model_versions: { name: string; version: string } | null;
};

// The most recent stored results across all of the user's machines, and how
// many results there are in total. Read-only; RLS limits rows to the owner.
export async function listRecentAnalyses(limit = 5): Promise<{ items: RecentAnalysis[]; total: number }> {
  const { data, error, count } = await supabase()
    .from("predictions")
    .select(
      "id, created_at, decision, score, log_score, threshold, baseline_count, recording_id, recordings(machines(id, name, machine_type)), model_versions(name, version)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail("Could not load recent analyses.", error);
  const rows = data as unknown as RecentAnalysisRow[];
  return {
    total: count ?? rows.length,
    items: rows.map(({ recordings, model_versions, ...p }) => ({
      ...p,
      machine: recordings?.machines ?? null,
      model: model_versions,
    })),
  };
}

export type ModelVersionInfo = Pick<
  Tables["model_versions"]["Row"],
  "name" | "version" | "preprocessing_version" | "evidence_ref" | "limitations" | "machine_type"
>;

// The product model (ADR-010 to ADR-013: 4-layer AST, frequency pooling, condition head;
// bearings use the head + frozen-feature fusion), as registered in public.model_versions.
// Its limitations are copied verbatim from the model bundle.
export const PRODUCT_MODEL_NAME = "sonovate-ast-head";

export async function getProductModel(): Promise<ModelVersionInfo | null> {
  const { data, error } = await supabase()
    .from("model_versions")
    .select("name, version, preprocessing_version, evidence_ref, limitations, machine_type")
    .eq("name", PRODUCT_MODEL_NAME)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail("Could not load the model details.", error);
  return data;
}

export type ServiceStatus = "online" | "unreachable" | "not_configured";

// Pings the inference service's public health endpoint. It says only whether
// analysis requests can currently reach the service.
export async function checkAnalysisService(timeoutMs = 4000): Promise<ServiceStatus> {
  if (!INFERENCE_API_URL) return "not_configured";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${INFERENCE_API_URL}/v1/health`, { signal: controller.signal });
    return res.ok ? "online" : "unreachable";
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timer);
  }
}

// --- inference service ------------------------------------------------------

export type AnalysisResult =
  | { status: "completed"; notice: string }
  | { status: "no_validated_model"; message: string }
  | { status: "unsupported_machine_type"; message: string }
  | { status: "baseline_required"; message: string; count: number; required: number }
  | { status: "baseline_recording"; message: string }
  | { status: "error"; code: string; message: string };

export async function requestAnalysis(recordingId: string): Promise<AnalysisResult> {
  if (!INFERENCE_API_URL) {
    return { status: "error", code: "not_configured", message: "The inference service URL is not configured." };
  }
  const session = await getSession();
  if (!session) return { status: "error", code: "unauthenticated", message: "You are signed out. Sign in again." };

  let res: Response;
  try {
    res = await fetch(`${INFERENCE_API_URL}/v1/analyses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ recording_id: recordingId }),
    });
  } catch {
    return {
      status: "error",
      code: "unreachable",
      message: "The analysis service could not be reached. Check that it is running.",
    };
  }

  const body = await res.json().catch(() => null);
  // The stored prediction is re-read from the database for display, so the
  // page shows exactly what was saved.
  if (res.ok && body?.status === "completed") return { status: "completed", notice: String(body.notice ?? "") };
  const code: string = body?.error?.code ?? "unexpected_response";
  const message: string = body?.error?.message ?? `Unexpected response from the analysis service (${res.status}).`;
  if (code === "no_validated_model") return { status: "no_validated_model", message };
  if (code === "unsupported_machine_type") return { status: "unsupported_machine_type", message };
  if (code === "baseline_recording") return { status: "baseline_recording", message };
  if (code === "baseline_required") {
    const details = body?.error?.details ?? {};
    return {
      status: "baseline_required",
      message,
      count: Number(details.baseline_count ?? 0),
      required: Number(details.baseline_required ?? BASELINE_REQUIRED),
    };
  }
  return { status: "error", code, message };
}

// Deletes the signed-in user's account through the inference service, which
// holds the secret key: all audio files, all data and the login itself.
export const ACCOUNT_DELETION_PHRASE = "delete my account";

export async function deleteAccount(): Promise<void> {
  if (!INFERENCE_API_URL) throw new Error("The service URL is not configured.");
  const session = await getSession();
  if (!session) throw new Error("You are signed out. Sign in again.");
  let res: Response;
  try {
    res = await fetch(`${INFERENCE_API_URL}/v1/account`, {
      method: "DELETE",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ confirm: ACCOUNT_DELETION_PHRASE }),
    });
  } catch {
    throw new Error("The service could not be reached. Nothing was deleted.");
  }
  if (res.status !== 204) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Account deletion failed (${res.status}).`);
  }
  await supabase().auth.signOut();
}
