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
export type MachineInput = Pick<Machine, "name" | "machine_type" | "location" | "notes">;
export type ContextInput = { name: string; value: number; unit: string };

export type Prediction = Tables["predictions"]["Row"] & {
  model_versions: Pick<
    Tables["model_versions"]["Row"],
    "name" | "version" | "preprocessing_version" | "machine_type" | "limitations"
  > | null;
};

// Minimum baseline recordings before results are shown (ADR-007, EXP-005).
export const BASELINE_REQUIRED = 10;

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
    throw new Error("Frontend is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }
  // PKCE: OAuth redirects come back with a one-time ?code= that the client
  // exchanges itself (detectSessionInUrl), instead of tokens in the URL.
  client ??= createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { flowType: "pkce" },
  });
  return client;
}

function fail(message: string, error: unknown): never {
  // Supabase errors can be technical; keep the user-facing text plain.
  console.error(message, error);
  throw new Error(message);
}

// --- auth -------------------------------------------------------------------

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase().auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
  const { data, error } = await supabase().auth.signUp({ email, password });
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

export async function listMachines(): Promise<Machine[]> {
  const { data, error } = await supabase().from("machines").select("*").order("created_at", { ascending: false });
  if (error) fail("Could not load machines.", error);
  return data;
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
  if (rowError) fail("Could not save the recording.", rowError);

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

// Every recording of a machine with its context and any stored predictions,
// newest first. Predictions exist only once a validated model is registered.
export async function listMachineHistory(machineId: string): Promise<HistoryEntry[]> {
  const { data, error } = await supabase()
    .from("recordings")
    .select("*, context_readings(*), predictions(*, model_versions(name, version, preprocessing_version, machine_type, limitations))")
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
