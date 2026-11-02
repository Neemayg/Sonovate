// Shared display of a recording's operating context and stored predictions,
// used by the analysis page and the machine history page.

import type { ContextReading, Prediction } from "@/lib/api";
import { modelInputFor, rangeNotice, type MachineType } from "@/lib/modelInputs";
import { formatDateTime } from "./Status";

export const SCORE_NOTE =
  "Anomaly scores are uncalibrated: they are not a failure probability, a health percentage or a diagnosis.";

function decisionLabel(decision: string): string {
  return decision === "above_threshold"
    ? "Above the model's threshold (less typical than its reference data)"
    : "Below the model's threshold (similar to its reference data)";
}

export function ContextList({ readings, machineType }: { readings: ContextReading[]; machineType: MachineType }) {
  return (
    <dl className="details">
      {readings.map((c) => {
        const input = modelInputFor(machineType, c.name);
        const notice = rangeNotice(machineType, c.name, c.value, c.unit);
        return (
          <div key={c.id} className="details-pair">
            <dt>{input?.label ?? c.name}</dt>
            <dd>
              {c.value} {c.unit}
              {notice && <span className="notice notice-warning small inline-notice">{notice}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function PredictionView({ p }: { p: Prediction }) {
  return (
    <dl className="details">
      <dt>Result</dt>
      <dd>{decisionLabel(p.decision)}</dd>
      <dt>Anomaly score</dt>
      <dd>
        {p.score.toPrecision(4)} <span className="muted">(threshold {p.threshold.toPrecision(4)})</span>
      </dd>
      <dt>Model</dt>
      <dd>
        {p.model_versions
          ? `${p.model_versions.name} ${p.model_versions.version} (preprocessing ${p.model_versions.preprocessing_version})`
          : "Unknown model version"}
      </dd>
      <dt>Analysed</dt>
      <dd>{formatDateTime(p.created_at)}</dd>
    </dl>
  );
}
