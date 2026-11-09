// Shared display of a recording's operating context and stored predictions,
// used by the analysis page and the machine history page.

import type { ContextReading, Prediction } from "@/lib/api";
import { modelInputFor, rangeNotice, type MachineType } from "@/lib/modelInputs";
import { ScoreStrip } from "./ScoreStrip";
import { formatDateTime } from "./Status";

export const SCORE_NOTE =
  "Anomaly scores are uncalibrated: they are not a failure probability, a health percentage or a diagnosis.";

// ADR-007: every result carries this notice.
export const PROTOTYPE_NOTICE = "Research prototype, low sensitivity. Not a diagnosis or failure prediction.";

function decisionLabel(decision: string): string {
  return decision === "above_threshold"
    ? "Above this machine's baseline threshold"
    : "Below this machine's baseline threshold";
}

function decisionExplanation(decision: string): string {
  return decision === "above_threshold"
    ? "This recording is less typical than the machine's baseline recordings. It is worth a closer look; it is not a confirmed fault."
    : "This recording is similar to the machine's baseline recordings. That does not mean the machine is healthy: the model misses most anomalies.";
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
              <span className="num">
                {c.value} {c.unit}
              </span>
              {notice && <span className="notice notice-warning small inline-notice">{notice}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function PredictionView({ p }: { p: Prediction }) {
  const model = p.model_versions;
  return (
    <article className="result" aria-label={`Result from ${formatDateTime(p.created_at)}`}>
      <p className="notice notice-warning prototype-notice" role="note">
        <strong>{PROTOTYPE_NOTICE}</strong>
      </p>
      <p className="result-decision">
        <strong>{decisionLabel(p.decision)}</strong>
      </p>
      <p className="muted small">{decisionExplanation(p.decision)}</p>
      {p.log_score !== null && <ScoreStrip logScore={p.log_score} threshold={p.threshold} />}
      <dl className="details">
        <dt>{p.window_count > 1 ? "Mean log score" : "Log score"}</dt>
        <dd className="num">
          {p.log_score !== null ? p.log_score.toFixed(3) : "—"}{" "}
          <span className="muted">(threshold {p.threshold.toFixed(3)})</span>
        </dd>
        <dt>Analysed as</dt>
        <dd>
          {p.window_count > 1
            ? `${p.window_count} windows of 10 s, judged on their mean (${p.window_count >= 6 ? "60 s rule" : p.window_count >= 3 ? "30 s rule" : "single-window threshold"})`
            : "One 10 s window"}
        </dd>
        {p.window_count > 1 && p.window_log_scores && (
          <>
            <dt>Window log scores</dt>
            <dd className="num">
              <ol className="window-scores" aria-label="Log score of each 10 s window, in order">
                {p.window_log_scores.map((v, i) => (
                  <li key={i}>
                    <span className="muted">{i * 10}–{i * 10 + 10} s</span> {v.toFixed(3)}
                  </li>
                ))}
              </ol>
            </dd>
          </>
        )}
        <dt>Raw score</dt>
        <dd className="num">{p.score.toPrecision(4)}</dd>
        <dt>Threshold from</dt>
        <dd>{p.baseline_count !== null ? `${p.baseline_count} baseline recordings` : "—"}</dd>
        <dt>Model</dt>
        <dd>
          {model
            ? `${model.name} ${model.version} (preprocessing ${model.preprocessing_version})`
            : "Unknown model version"}
        </dd>
        <dt>Analysed</dt>
        <dd className="num">{formatDateTime(p.created_at)}</dd>
      </dl>
      {model && model.limitations.length > 0 && (
        <div className="limitations">
          <p className="small">
            <strong>Limitations of this model</strong>
          </p>
          <ul className="small">
            {model.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
