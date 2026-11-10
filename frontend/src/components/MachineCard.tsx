import Link from "next/link";
import { BASELINE_REQUIRED, type MachineOverview } from "@/lib/api";
import { MODEL_INPUTS, machineTypeLabel } from "@/lib/modelInputs";
import { BaselineMeter } from "./BaselineMeter";
import { MachineAlertNotice } from "./MachineAlertNotice";
import { PROTOTYPE_NOTICE } from "./RecordingDetails";
import { formatDateTime } from "./Status";

export type MachineStatus =
  "unsupported" | "needs_baseline" | "ready" | "has_result";

export function machineStatus(m: MachineOverview): MachineStatus {
  if (MODEL_INPUTS[m.machine_type].length === 0) return "unsupported";
  if (m.latest) return "has_result";
  return m.baselineCount >= BASELINE_REQUIRED ? "ready" : "needs_baseline";
}

function decisionText(decision: string): string {
  return decision === "above_threshold"
    ? "Above this machine's baseline threshold"
    : "Below this machine's baseline threshold";
}

const STATUS_LABEL: Record<MachineStatus, string> = {
  unsupported: "Not analysable",
  needs_baseline: "Needs baseline",
  ready: "Ready to analyse",
  has_result: "Has results",
};

// One machine in the overview. Shows facts only: no health score, no
// colour-coded verdict, and the prototype notice next to any result.
export function MachineCard({ machine: m }: { machine: MachineOverview }) {
  const status = machineStatus(m);
  const titleId = `machine-${m.id}-title`;

  return (
    <article
      className={`machine-card is-${status}${m.alert?.alert ? " has-alert" : ""}`}
      aria-labelledby={titleId}
    >
      <div className="machine-card-badges">
        <span
          className={`status-badge is-${m.alert?.alert ? "alert" : status}`}
        >
          <span aria-hidden="true" />
          {m.alert?.alert ? "Machine alert" : STATUS_LABEL[status]}
        </span>
      </div>
      <div className="machine-card-head">
        <h3 id={titleId}>
          <Link href={`/machines/${m.id}`}>{m.name}</Link>
        </h3>
        <span className="tag">{machineTypeLabel(m.machine_type)}</span>
      </div>
      {m.location && <p className="muted small">{m.location}</p>}

      <div className="machine-card-status">
        {status === "unsupported" && (
          <p className="small">
            Analysis is not available for this machine type.
          </p>
        )}

        {status === "needs_baseline" && (
          <BaselineMeter
            count={m.baselineCount}
            required={BASELINE_REQUIRED}
            label={`Baseline recordings for ${m.name}`}
            caption="Baseline needed before analysis"
          />
        )}

        {status === "ready" && (
          <p className="small">
            <strong>Baseline ready</strong>{" "}
            <span className="num">({m.baselineCount})</span> · no analysis yet
          </p>
        )}

        {status === "has_result" && m.latest && (
          <>
            <p className="small">
              Latest result ({formatDateTime(m.latest.created_at)}):{" "}
              <Link
                href={`/recordings/${m.latest.recording_id}`}
                className="card-link"
              >
                <strong>{decisionText(m.latest.decision)}</strong>
              </Link>
            </p>
            {m.recent.length > 0 && (
              <div
                className="mc-dots"
                aria-label={`Latest ${m.recent.length} results, oldest first: ${m.recent.map((r) => (r.above ? "above" : "below")).join(", ")}`}
              >
                {m.recent.map((r) => (
                  <Link
                    key={r.recording_id}
                    href={`/recordings/${r.recording_id}`}
                    className={`mc-dot ${r.above ? "is-above" : "is-below"}`}
                    title={`${r.above ? "Above" : "Below"} threshold · ${formatDateTime(r.created_at)}`}
                    aria-hidden="true"
                    tabIndex={-1}
                  />
                ))}
                <span className="muted small">latest {m.recent.length}</span>
              </div>
            )}
            <p className="muted small">{PROTOTYPE_NOTICE}</p>
            <MachineAlertNotice alert={m.alert} compact />
          </>
        )}
      </div>

      <p className="muted small machine-card-meta">
        {m.recordingCount} {m.recordingCount === 1 ? "recording" : "recordings"}
        {m.lastUploadAt
          ? ` · last upload ${formatDateTime(m.lastUploadAt)}`
          : " · nothing uploaded yet"}
        {" · "}
        <Link href={`/machines/${m.id}/history`} className="card-link">
          History
        </Link>
      </p>
    </article>
  );
}
