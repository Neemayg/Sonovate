// Result and dashboard summaries built only from stored rows. Pure functions
// with no runtime imports, so they can be tested with `node --test`
// (tests/results.test.mjs).
//
// Wording rules (ADR-007, ADR-009): "Above threshold" means unusual compared
// with this machine's own baseline; "Within threshold" means not flagged by
// this analysis. Neither is a health level, a probability or a diagnosis.

export const ABOVE_LABEL = "Above threshold";
export const WITHIN_LABEL = "Within threshold";
export const ABOVE_MEANING = "Unusual compared with this machine's baseline";
export const WITHIN_MEANING = "Not flagged by this analysis";

type PredictionLike = {
  created_at: string;
  decision: string;
  log_score: number | null;
  score: number;
  threshold: number;
  window_count: number;
  sensitivity: string;
  baseline_count: number | null;
};

type EntryLike = {
  id: string;
  kind: string;
  created_at: string;
  recorded_at: string | null;
  original_filename: string | null;
  duration_seconds: number | null;
  predictions: PredictionLike[];
};

/** The latest stored result of one check recording, on the scale the decision used. */
export type CheckResult = {
  recordingId: string;
  /** Check number in upload order (1 = first uploaded), as in recordingNumbers. */
  number: number;
  recordedAt: string;
  analysedAt: string;
  above: boolean;
  /** Recording-level log score: the mean of the 10 s window log scores (ADR-012). */
  logScore: number;
  /** The recording-level log threshold that was applied to this check. */
  threshold: number;
  windowCount: number;
  sensitivity: string;
  baselineCount: number | null;
  filename: string | null;
  durationSeconds: number | null;
};

function logScoreOf(p: PredictionLike): number | null {
  if (p.log_score !== null && Number.isFinite(p.log_score)) return p.log_score;
  // Older rows have no log score; the stored score is exp(log score) by definition.
  return p.score > 0 && Number.isFinite(p.score) ? Math.log(p.score) : null;
}

/**
 * The latest stored result of every analysed check, in upload order (oldest
 * first). `numbers` maps recording id to its check number (recordingNumbers).
 * Checks without a stored result are left out: there is nothing to plot.
 */
export function checkResults(entries: EntryLike[], numbers: Map<string, number>): CheckResult[] {
  const out: CheckResult[] = [];
  for (const e of entries) {
    if (e.kind !== "analysis" || e.predictions.length === 0) continue;
    const p = e.predictions.reduce((a, b) => (b.created_at > a.created_at ? b : a));
    const logScore = logScoreOf(p);
    if (logScore === null || !Number.isFinite(p.threshold)) continue;
    out.push({
      recordingId: e.id,
      number: numbers.get(e.id) ?? 0,
      recordedAt: e.recorded_at ?? e.created_at,
      analysedAt: p.created_at,
      above: p.decision === "above_threshold",
      logScore,
      threshold: p.threshold,
      windowCount: p.window_count,
      sensitivity: p.sensitivity,
      baselineCount: p.baseline_count,
      filename: e.original_filename,
      durationSeconds: e.duration_seconds,
    });
  }
  return out.sort((a, b) => a.number - b.number || a.recordingId.localeCompare(b.recordingId));
}

export type ResultFilter = "all" | "above" | "within";

export function matchesResultFilter(r: Pick<CheckResult, "above">, f: ResultFilter): boolean {
  return f === "all" || (f === "above" ? r.above : !r.above);
}

export type ResultSummary = {
  analysed: number;
  above: number;
  within: number;
  /** For example "2 of 3 checks were above this machine's expected acoustic range." */
  headline: string;
  /** A plain interpretation that makes no health or fault claim. */
  interpretation: string;
};

export function resultSummary(results: Pick<CheckResult, "above">[]): ResultSummary {
  const analysed = results.length;
  const above = results.filter((r) => r.above).length;
  const within = analysed - above;
  const noun = analysed === 1 ? "check" : "checks";
  let headline: string;
  if (analysed === 0) headline = "No checks have been analysed yet.";
  else if (above === 0)
    headline =
      analysed === 1
        ? "The analysed check was within this machine's expected acoustic range."
        : `None of the ${analysed} checks were above this machine's expected acoustic range.`;
  else headline = `${above} of ${analysed} ${noun} ${above === 1 ? "was" : "were"} above this machine's expected acoustic range.`;

  let interpretation: string;
  if (analysed === 0) {
    interpretation = "Analyse a recording to compare it with this machine's baseline.";
  } else if (above === 0) {
    interpretation =
      "No check was flagged as unusual compared with this machine's baseline. This does not confirm that the machine is fault-free.";
  } else if (above === analysed) {
    interpretation =
      "Every analysed check sounded unusual compared with this machine's baseline. Inspect the machine and listen to the flagged recordings; this does not confirm a fault.";
  } else {
    interpretation = `${above === 1 ? "One check sounded" : "Some checks sounded"} unusual compared with this machine's baseline; the others were not flagged. Review the flagged ${above === 1 ? "recording" : "recordings"}; this does not confirm a fault.`;
  }
  return { analysed, above, within, headline, interpretation };
}

/** Previous and next analysed check around `recordingId`, in check order. */
export function neighbours<T extends { recordingId: string }>(
  results: T[],
  recordingId: string,
): { previous: T | null; next: T | null; index: number } {
  const index = results.findIndex((r) => r.recordingId === recordingId);
  if (index === -1) return { previous: null, next: null, index };
  return { previous: results[index - 1] ?? null, next: results[index + 1] ?? null, index };
}

/** True when the applied threshold is not the same for every check (length, sensitivity or baselines differ). */
export function thresholdVaries(results: Pick<CheckResult, "threshold">[]): boolean {
  return results.some((r) => Math.abs(r.threshold - results[0].threshold) > 1e-9);
}

// --- dashboard -------------------------------------------------------------------

export const MIN_BASELINES_FOR_CHECK = 10;

export type DashMachine = {
  id: string;
  name: string;
  analysable: boolean;
  baselineCount: number;
  /** ADR-009 machine alert currently active. */
  alert: boolean;
  /** Latest stored result across the machine's checks, if any. */
  latestCheck: { above: boolean; created_at: string; recording_id: string } | null;
};

export type AttentionReason = "alert" | "latest_above";

/** Why a machine needs attention, or null. An active machine alert outranks a single flagged check. */
export function attentionReason(m: Pick<DashMachine, "analysable" | "alert" | "latestCheck">): AttentionReason | null {
  if (!m.analysable) return null;
  if (m.alert) return "alert";
  if (m.latestCheck?.above) return "latest_above";
  return null;
}

export const ATTENTION_TEXT: Record<AttentionReason, string> = {
  alert: "Machine alert: 2 or more of the last 3 checks above threshold",
  latest_above: "Latest check above threshold",
};

export type OverviewCounts = { machines: number; attention: number; ready: number };

/** Counts that can be computed exactly from the stored rows. */
export function overviewCounts(machines: DashMachine[]): OverviewCounts {
  return {
    machines: machines.length,
    attention: machines.filter((m) => attentionReason(m) !== null).length,
    ready: machines.filter((m) => m.analysable && m.baselineCount >= MIN_BASELINES_FOR_CHECK).length,
  };
}

export type AccountNextAction =
  | { kind: "register" }
  | { kind: "attention"; machine: DashMachine; recordingId: string | null }
  | { kind: "baseline"; machine: DashMachine }
  | { kind: "first_check"; machine: DashMachine }
  | { kind: "check"; machine: DashMachine }
  | { kind: "records_only" };

/**
 * The single most useful next step for the account: attention first, then
 * unfinished baselines, then a first check, then the machine checked longest ago.
 */
export function accountNextAction(machines: DashMachine[]): AccountNextAction {
  if (machines.length === 0) return { kind: "register" };
  const byName = (a: DashMachine, b: DashMachine) => a.name.localeCompare(b.name);
  const analysable = machines.filter((m) => m.analysable);
  const alerts = analysable.filter((m) => attentionReason(m) === "alert").sort(byName);
  const flagged = analysable.filter((m) => attentionReason(m) === "latest_above").sort(byName);
  const pick = alerts[0] ?? flagged[0];
  if (pick) return { kind: "attention", machine: pick, recordingId: pick.latestCheck?.recording_id ?? null };
  const setup = analysable
    .filter((m) => m.baselineCount < MIN_BASELINES_FOR_CHECK)
    .sort((a, b) => b.baselineCount - a.baselineCount || byName(a, b))[0];
  if (setup) return { kind: "baseline", machine: setup };
  const first = analysable.filter((m) => m.latestCheck === null).sort(byName)[0];
  if (first) return { kind: "first_check", machine: first };
  const oldest = [...analysable].sort(
    (a, b) => (a.latestCheck?.created_at ?? "").localeCompare(b.latestCheck?.created_at ?? "") || byName(a, b),
  )[0];
  if (oldest) return { kind: "check", machine: oldest };
  return { kind: "records_only" };
}

// --- recent activity ---------------------------------------------------------------

export type Activity =
  | { kind: "analysis"; at: string; machineId: string | null; machineName: string; recordingId: string; above: boolean }
  | { kind: "alert"; at: string; machineId: string; machineName: string; ended: boolean }
  | { kind: "baselines"; at: string; machineId: string; machineName: string; count: number };

type BaselineUpload = { machineId: string; machineName: string; created_at: string };

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Baseline uploads grouped per machine and local calendar day; `at` is the latest upload of the group. */
export function groupBaselineUploads(uploads: BaselineUpload[]): Activity[] {
  const groups = new Map<string, Extract<Activity, { kind: "baselines" }>>();
  for (const u of uploads) {
    const key = `${u.machineId}|${dayKey(u.created_at)}`;
    const g = groups.get(key);
    if (g) {
      g.count += 1;
      if (u.created_at > g.at) g.at = u.created_at;
    } else {
      groups.set(key, { kind: "baselines", at: u.created_at, machineId: u.machineId, machineName: u.machineName, count: 1 });
    }
  }
  return [...groups.values()];
}

/** All activity, newest first, at most `limit` items. */
export function activityFeed(items: Activity[], limit: number): Activity[] {
  return [...items].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
