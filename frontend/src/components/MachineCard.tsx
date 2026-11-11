import Link from "next/link";
import type { CSSProperties } from "react";
import { BASELINE_RECOMMENDED, BASELINE_REQUIRED, type MachineOverview } from "@/lib/api";
import { MODEL_INPUTS, machineTypeLabel } from "@/lib/modelInputs";
import { nextAction, stateSummary } from "@/lib/monitoring";
import { StatusBadge, overviewState } from "./MonitoringStatus";
import { formatDateTime } from "./Status";

export type MachineStatus = "unsupported" | "needs_baseline" | "ready" | "has_result";

export function machineStatus(m: MachineOverview): MachineStatus {
  if (MODEL_INPUTS[m.machine_type].length === 0) return "unsupported";
  if (m.latest) return "has_result";
  return m.baselineCount >= BASELINE_REQUIRED ? "ready" : "needs_baseline";
}

/** Plain wording for a stored decision. */
export function resultWord(decision: string): string {
  return decision === "above_threshold" ? "Unusual compared with normal" : "Similar to normal";
}

// One machine in the overview. It answers: what is its status, what did the
// latest check say, and what should happen next. The machine name is a
// stretched link covering the card; the action link sits above it, so no
// interactive element is nested inside another.
export function MachineCard({ machine: m }: { machine: MachineOverview }) {
  const state = overviewState(m);
  const action = nextAction(state);
  const titleId = `machine-${m.id}-title`;
  const analysable = state !== "records_only";
  const latestCheck = m.recent[m.recent.length - 1] ?? null;
  const baselinePct = Math.min(1, m.baselineCount / BASELINE_RECOMMENDED);

  return (
    <article className={`mcard is-${state}`} aria-labelledby={titleId}>
      <div className="mcard-top">
        <StatusBadge state={state} />
        <span className="tag">{machineTypeLabel(m.machine_type)}</span>
      </div>

      <h3 id={titleId} className="mcard-title">
        <Link href={`/machines/${m.id}`} className="mcard-link">
          {m.name}
        </Link>
      </h3>
      <p className="muted small mcard-loc">{m.location ?? "No location set"}</p>

      <dl className="mcard-facts">
        {analysable && (
          <div>
            <dt>Baseline</dt>
            <dd>
              <span className="num">{m.baselineCount}</span>
              <span className="muted"> / {BASELINE_REQUIRED} min · {BASELINE_RECOMMENDED} rec.</span>
              <span
                className={`mcard-bar${m.baselineCount >= BASELINE_REQUIRED ? " is-ready" : ""}`}
                style={{ "--p": baselinePct, "--min": BASELINE_REQUIRED / BASELINE_RECOMMENDED } as CSSProperties}
                aria-hidden="true"
              />
            </dd>
          </div>
        )}
        {analysable && (
          <div>
            <dt>Latest check</dt>
            <dd>
              {latestCheck ? (
                <>
                  <span className={latestCheck.above ? "mcard-above" : undefined}>
                    {latestCheck.above ? "Unusual compared with normal" : "Similar to normal"}
                  </span>
                  <span className="muted small"> · {formatDateTime(latestCheck.created_at)}</span>
                </>
              ) : (
                <span className="muted">No checks yet</span>
              )}
            </dd>
          </div>
        )}
        {m.recent.length > 1 && (
          <div>
            <dt>Recent checks</dt>
            <dd>
              <span
                className="mc-dots"
                role="img"
                aria-label={`Latest ${m.recent.length} checks, oldest first: ${m.recent
                  .map((r) => (r.above ? "unusual" : "similar"))
                  .join(", ")}`}
              >
                {m.recent.map((r) => (
                  <span key={r.recording_id} className={`mc-dot ${r.above ? "is-above" : "is-below"}`} />
                ))}
              </span>
            </dd>
          </div>
        )}
        <div>
          <dt>Last recording</dt>
          <dd className="muted">{m.lastUploadAt ? formatDateTime(m.lastUploadAt) : "Nothing uploaded yet"}</dd>
        </div>
      </dl>

      <p className="mcard-summary small">{stateSummary(state, m.baselineCount)}</p>

      <div className="mcard-actions">
        <Link
          href={`/machines/${m.id}#${action.anchor}`}
          className={`btn btn-sm ${state === "monitoring" || state === "records_only" ? "btn-outline" : "btn-primary"}`}
        >
          {action.label}
        </Link>
      </div>
    </article>
  );
}
