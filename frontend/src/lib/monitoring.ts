// Monitoring status language and friendly recording names, shared by the
// dashboard, machine pages, history and result pages. Pure functions with no
// imports, so they can be tested with `node --test` (tests/monitoring.test.mjs).
//
// The status never says "healthy": a machine with no alert has only not met
// the ADR-009 rule (at least 2 of the last 3 checks above threshold).

export const MIN_BASELINES = 10;

export type MonitoringState = "records_only" | "baseline_incomplete" | "ready_first_check" | "monitoring" | "alert";

export type MonitoringInput = {
  /** False for machine types without an acoustic model ("other"). */
  analysable: boolean;
  baselineCount: number;
  /** Number of check recordings with at least one stored result. */
  checksWithResult: number;
  /** ADR-009 machine alert from the machine_alerts view. */
  alert: boolean;
};

export function monitoringState(m: MonitoringInput): MonitoringState {
  if (!m.analysable) return "records_only";
  if (m.alert) return "alert";
  if (m.baselineCount < MIN_BASELINES) return "baseline_incomplete";
  if (m.checksWithResult === 0) return "ready_first_check";
  return "monitoring";
}

export const STATE_LABEL: Record<MonitoringState, string> = {
  records_only: "Records only",
  baseline_incomplete: "Baseline incomplete",
  ready_first_check: "Ready for first check",
  monitoring: "No current machine alert",
  alert: "Repeated unusual readings",
};

/** One sentence describing the state, for cards and headers. */
export function stateSummary(state: MonitoringState, baselineCount: number): string {
  switch (state) {
    case "records_only":
      return "Stored for record keeping; acoustic analysis is not available for this category.";
    case "baseline_incomplete": {
      const left = Math.max(0, MIN_BASELINES - baselineCount);
      return `${left} more normal recording${left === 1 ? "" : "s"} needed before the first check.`;
    }
    case "ready_first_check":
      return "Your machine is ready. Upload a recording to run its first check.";
    case "monitoring":
      return "No current machine alert. This does not confirm that the machine is fault-free.";
    case "alert":
      return "Repeated checks have been above this machine's baseline threshold. Inspect the machine and review its recordings.";
  }
}

export type NextAction = { label: string; anchor: "baseline" | "check" | "alert" | "record" };

/** The one recommended next step for a machine in this state; the anchor is a section on its page. */
export function nextAction(state: MonitoringState): NextAction {
  switch (state) {
    case "records_only":
      return { label: "Open machine", anchor: "record" };
    case "baseline_incomplete":
      return { label: "Add baseline recordings", anchor: "baseline" };
    case "ready_first_check":
      return { label: "Run first check", anchor: "check" };
    case "monitoring":
      return { label: "Run a new check", anchor: "check" };
    case "alert":
      return { label: "Review alert", anchor: "alert" };
  }
}

/** Sort order for "needs attention": alerts first, then setup work, then routine monitoring. */
export const ATTENTION_ORDER: Record<MonitoringState, number> = {
  alert: 0,
  baseline_incomplete: 1,
  ready_first_check: 2,
  monitoring: 3,
  records_only: 4,
};

// --- friendly recording names -----------------------------------------------

type RecordingLike = { id: string; kind: string; created_at: string; recorded_at: string | null };

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function shortDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Recordings are numbered per kind in upload order (1 = first uploaded), so a
 * number stays the same when newer ones are added. Returns id -> number.
 */
export function recordingNumbers(recordings: RecordingLike[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const kind of ["baseline", "analysis"]) {
    recordings
      .filter((r) => r.kind === kind)
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .forEach((r, i) => out.set(r.id, i + 1));
  }
  return out;
}

/** A readable name for a recording; the original filename stays available in its details. */
export function recordingLabel(r: RecordingLike, number?: number): string {
  const when = r.recorded_at ?? r.created_at;
  const n = number ? ` ${number}` : "";
  if (r.kind === "baseline") return `Normal reference${n} · ${shortDate(when)}`;
  return `Check${n} · ${shortDateTime(when)}`;
}

/** The name without its date, for places that show the date separately. */
export function recordingShortLabel(r: Pick<RecordingLike, "kind">, number?: number): string {
  const n = number ? ` ${number}` : "";
  return r.kind === "baseline" ? `Normal reference${n}` : `Check${n}`;
}

/** Human duration such as "60 s" or "1 min 5 s". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? `${m} min` : `${m} min ${rest} s`;
}
