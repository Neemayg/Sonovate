import Link from "next/link";
import { BASELINE_REQUIRED, type MachineOverview } from "@/lib/api";
import { MODEL_INPUTS, machineTypeLabel } from "@/lib/modelInputs";
import { PROTOTYPE_NOTICE } from "./RecordingDetails";
import { formatDateTime } from "./Status";

export type MachineStatus = "unsupported" | "needs_baseline" | "ready" | "has_result";

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

// One machine in the overview. Shows facts only: no health score, no
// colour-coded verdict, and the prototype notice next to any result.
export function MachineCard({ machine: m }: { machine: MachineOverview }) {
  const status = machineStatus(m);
  const titleId = `machine-${m.id}-title`;

  return (
    <article className="machine-card" aria-labelledby={titleId}>
      <div className="machine-card-head">
        <h3 id={titleId}>
          <Link href={`/machines/${m.id}`}>{m.name}</Link>
        </h3>
        <span className="tag">{machineTypeLabel(m.machine_type)}</span>
      </div>
      {m.location && <p className="muted small">{m.location}</p>}

      <div className="machine-card-status">
        {status === "unsupported" && (
          <p className="small">Analysis is not available for this machine type.</p>
        )}

        {status === "needs_baseline" && (
          <>
            <p className="small" id={`${titleId}-baseline`}>
              <strong>
                Baseline {m.baselineCount}/{BASELINE_REQUIRED}
              </strong>{" "}
              · {BASELINE_REQUIRED - m.baselineCount} more needed before analysis
            </p>
            <progress
              value={m.baselineCount}
              max={BASELINE_REQUIRED}
              aria-labelledby={`${titleId}-baseline`}
            />
          </>
        )}

        {status === "ready" && (
          <p className="small">
            <strong>Baseline ready</strong> ({m.baselineCount} recordings) · no analysis yet
          </p>
        )}

        {status === "has_result" && m.latest && (
          <>
            <p className="small">
              Latest result ({formatDateTime(m.latest.created_at)}):{" "}
              <Link href={`/recordings/${m.latest.recording_id}`}>
                <strong>{decisionText(m.latest.decision)}</strong>
              </Link>
            </p>
            <p className="muted small">{PROTOTYPE_NOTICE}</p>
          </>
        )}
      </div>

      <p className="muted small machine-card-meta">
        {m.recordingCount} {m.recordingCount === 1 ? "recording" : "recordings"}
        {m.lastUploadAt ? ` · last upload ${formatDateTime(m.lastUploadAt)}` : " · nothing uploaded yet"}
        {" · "}
        <Link href={`/machines/${m.id}/history`}>History</Link>
      </p>
    </article>
  );
}
