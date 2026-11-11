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

// Plain-language reading of a stored result. Every sentence is derived from the
// stored prediction (decision, window count, baseline count); the tips repeat
// documented findings (EXP-017: more baselines; EXP-026: 60 s recordings).
function plainSummary(p: Prediction): { headline: string; body: string; next: string; tips: string[] } {
  const above = p.decision === "above_threshold";
  const seconds = p.window_count * 10;
  const baselines = p.baseline_count ?? 0;
  const compared = `Sonovate compared this ${seconds}-second recording with ${
    baselines > 0 ? `the ${baselines} normal recordings` : "the normal recordings"
  } of this machine.`;
  const tips: string[] = [];
  const high = p.sensitivity === "high";
  if (p.window_count < 6) tips.push("Record 60 seconds next time: longer recordings catch more problems.");
  if (baselines > 0 && baselines < 30) {
    tips.push(`Add more normal recordings to the baseline (${30 - baselines} more for the recommended 30): it then catches more problems.`);
  }
  return above
    ? {
        headline: "Sounds different from normal",
        body: `${compared} It sounded more unusual than this machine's normal limit.${
          high ? " This machine uses High sensitivity, which also flags more normal recordings." : ""
        }`,
        next: "Worth a closer look: listen to it next to a normal recording below, and check the machine. This is not a confirmed fault.",
        tips,
      }
    : {
        headline: "Sounds like its normal recordings",
        body: `${compared} It stayed within this machine's normal limit${high ? ", even with High sensitivity" : ""}.`,
        next: "No action suggested by the sound alone. This does not prove the machine is healthy: many problems are not heard by this model.",
        tips,
      };
}

const PLAIN_LIMITS = [
  "It tells you whether the sound has changed, not what is wrong or which part.",
  "It misses many problems, so “sounds normal” does not mean the machine is fine.",
  "So far it has been tested only on lab recordings of bearings and gearboxes.",
];

export function PredictionView({ p }: { p: Prediction }) {
  const model = p.model_versions;
  const summary = plainSummary(p);
  const above = p.decision === "above_threshold";
  return (
    <article className="result" aria-label={`Result from ${formatDateTime(p.created_at)}`}>
      <p className="notice notice-warning prototype-notice" role="note">
        <strong>{PROTOTYPE_NOTICE}</strong>
      </p>
      <div className={`plain-result ${above ? "plain-result-above" : "plain-result-below"}`}>
        <p className="result-decision">
          <strong>{summary.headline}</strong>
        </p>
        <p>{summary.body}</p>
        <p>{summary.next}</p>
        {summary.tips.length > 0 && (
          <ul className="small">
            {summary.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
      </div>
      {p.log_score !== null && <ScoreStrip logScore={p.log_score} threshold={p.threshold} />}
      <div className="limitations">
        <p className="small">
          <strong>What this result can and cannot tell you</strong>
        </p>
        <ul className="small">
          {PLAIN_LIMITS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <details className="technical-details">
        <summary>Technical details</summary>
        <p className="small">
          <strong>{decisionLabel(p.decision)}.</strong> {decisionExplanation(p.decision)}
        </p>
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
          <dt>Sensitivity</dt>
          <dd>{p.sensitivity === "high" ? "High (ADR-014)" : "Standard"}</dd>
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
              <strong>Limitations of this model (evidence)</strong>
            </p>
            <ul className="small">
              {model.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </details>
    </article>
  );
}
