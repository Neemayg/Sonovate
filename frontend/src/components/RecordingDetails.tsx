// Shared display of a recording's operating context and stored results, used
// by the result page and the history table. Every sentence and figure comes
// from the stored prediction; nothing is estimated. Scores are positions
// against this machine's threshold, never probabilities or health levels.

import type { CSSProperties } from "react";
import type { ContextReading, Prediction } from "@/lib/api";
import { modelInputFor, rangeNotice, type MachineType } from "@/lib/modelInputs";
import { ScoreStrip } from "./ScoreStrip";
import { formatDateTime } from "./Status";

export const SCORE_NOTE =
  "Anomaly scores are uncalibrated: they are not a failure probability, a health percentage or a diagnosis.";

// ADR-007: results carry this notice (shown once per page).
export const PROTOTYPE_NOTICE = "Research prototype, low sensitivity. Not a diagnosis or failure prediction.";

export function isAbove(p: Pick<Prediction, "decision">): boolean {
  return p.decision === "above_threshold";
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

// --- A. verdict ------------------------------------------------------------------

export function VerdictCard({ p }: { p: Prediction }) {
  const above = isAbove(p);
  const high = p.sensitivity === "high";
  return (
    <section className={`card verdict ${above ? "is-above" : "is-below"}`} aria-labelledby="verdict-title">
      <p className="eyebrow">Result · {formatDateTime(p.created_at)}</p>
      <h2 id="verdict-title" className="verdict-title">
        {above ? "Unusual compared with this machine's normal sound." : "Similar to this machine's normal sound."}
      </h2>
      <p className="verdict-body">
        {above
          ? "This recording differs from the machine's established acoustic baseline. It is worth inspecting, but this does not confirm a fault."
          : "This recording is relatively similar to the baseline. This does not guarantee that the machine is fault-free."}
      </p>
      {high && (
        <p className="small muted">
          This machine uses High sensitivity, which catches more unusual sounds but also flags more normal recordings.
        </p>
      )}
      {p.log_score !== null && <ScoreStrip logScore={p.log_score} threshold={p.threshold} plain />}
    </section>
  );
}

// --- C. per-window chart -----------------------------------------------------------

/** The stored per-window log scores, or the single score for a 10 s recording. */
export function windowScores(p: Prediction): number[] {
  if (p.window_log_scores && p.window_log_scores.length > 0) return p.window_log_scores;
  return p.log_score !== null ? [p.log_score] : [];
}

// One bar per 10 s window, drawn from the stored scores with the stored
// threshold as a reference line. The decision uses the mean of the windows
// (ADR-012), so a single tall bar is context, not a separate verdict, and it
// does not locate a physical fault.
export function WindowChart({ p }: { p: Prediction }) {
  const scores = windowScores(p);
  if (scores.length === 0) return null;
  const values = [...scores, p.threshold];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.25, 0.25);
  const min = lo - pad;
  const max = hi + pad;
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const label = scores
    .map((v, i) => `${i * 10} to ${i * 10 + 10} seconds: ${v > p.threshold ? "above" : "below"} the threshold line`)
    .join("; ");

  return (
    <section className="card" aria-labelledby="windows-title">
      <div className="card-header">
        <h2 id="windows-title">Each 10-second window</h2>
        <span className="muted small">
          {scores.length} window{scores.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="wchart" role="img" aria-label={`Window scores against the threshold. ${label}.`}>
        <div className="wchart-plot" style={{ "--thr": `${pct(p.threshold)}%` } as CSSProperties}>
          <span className="wchart-threshold" aria-hidden="true">
            <span>threshold</span>
          </span>
          {scores.map((v, i) => (
            <div key={i} className={`wchart-col ${v > p.threshold ? "is-above" : "is-below"}`}>
              <span className="wchart-bar" style={{ height: `${Math.max(2, pct(v))}%` } as CSSProperties} />
            </div>
          ))}
        </div>
        <div className="wchart-labels" aria-hidden="true">
          {scores.map((_, i) => (
            <span key={i} className="num">
              {i * 10}–{i * 10 + 10} s
            </span>
          ))}
        </div>
      </div>
      <p className="muted small">
        Taller bars sound less like this machine&apos;s normal recordings. The result is judged on the average of all
        windows, so one tall bar is not a separate verdict, and the bars do not show where a fault is.
      </p>
    </section>
  );
}

// --- D. what to do next -------------------------------------------------------------

export function NextStepsCard({ p }: { p: Prediction }) {
  const above = isAbove(p);
  const baselines = p.baseline_count ?? 0;
  const steps = above
    ? [
        "Inspect the machine using your normal maintenance procedures.",
        "Compare the sound against a normal reference with Listen & compare.",
        "Record another check under comparable operating conditions if appropriate.",
      ]
    : [
        "Continue normal inspections.",
        "Keep recording conditions consistent: same position, distance and operating setting.",
        "Continue monitoring over time with regular checks.",
      ];
  const tips: string[] = [];
  if (p.window_count < 6) tips.push("Record 60 seconds next time: longer recordings catch more unusual sounds.");
  if (baselines > 0 && baselines < 30) {
    tips.push(`Adding normal recordings (${30 - baselines} more for the recommended 30) widens the baseline's coverage.`);
  }
  return (
    <section className="card next-steps" aria-labelledby="next-steps-title">
      <h2 id="next-steps-title">What to do next</h2>
      <ul className="next-steps-list">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      {tips.length > 0 && (
        <ul className="small muted">
          {tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

// --- E. technical details ----------------------------------------------------------

function rule(p: Prediction): string {
  if (p.window_count <= 1) return "One 10 s window";
  return `${p.window_count} windows of 10 s, judged on their mean (${
    p.window_count >= 6 ? "60 s rule" : p.window_count >= 3 ? "30 s rule" : "single-window threshold"
  })`;
}

export function TechnicalDetails({ p, earlier = [] }: { p: Prediction; earlier?: Prediction[] }) {
  const model = p.model_versions;
  return (
    <details className="card technical-card">
      <summary>Technical details</summary>
      <dl className="details">
        <dt>Decision</dt>
        <dd>{isAbove(p) ? "Above this machine's baseline threshold" : "Below this machine's baseline threshold"}</dd>
        <dt>{p.window_count > 1 ? "Mean log score" : "Log score"}</dt>
        <dd className="num">{p.log_score !== null ? p.log_score.toFixed(3) : "—"}</dd>
        <dt>Threshold (log)</dt>
        <dd className="num">{p.threshold.toFixed(3)}</dd>
        <dt>Raw score</dt>
        <dd className="num">{p.score.toPrecision(4)}</dd>
        <dt>Analysed as</dt>
        <dd>{rule(p)}</dd>
        {windowScores(p).length > 1 && (
          <>
            <dt>Window log scores</dt>
            <dd className="num">
              <ol className="window-scores" aria-label="Log score of each 10 s window, in order">
                {windowScores(p).map((v, i) => (
                  <li key={i}>
                    <span className="muted">
                      {i * 10}–{i * 10 + 10} s
                    </span>{" "}
                    {v.toFixed(3)}
                  </li>
                ))}
              </ol>
            </dd>
          </>
        )}
        <dt>Sensitivity</dt>
        <dd>{p.sensitivity === "high" ? "High (ADR-014)" : "Standard"}</dd>
        <dt>Baseline count</dt>
        <dd className="num">{p.baseline_count ?? "—"}</dd>
        <dt>Model</dt>
        <dd>{model ? `${model.name} ${model.version}` : "Unknown model version"}</dd>
        <dt>Preprocessing</dt>
        <dd>{model?.preprocessing_version ?? "—"}</dd>
        <dt>Analysed</dt>
        <dd className="num">{formatDateTime(p.created_at)}</dd>
      </dl>
      <p className="muted small">{SCORE_NOTE}</p>
      {earlier.length > 0 && (
        <div className="earlier">
          <p className="small">
            <strong>Earlier results for this recording</strong> ({earlier.length})
          </p>
          <ul className="small">
            {earlier.map((e) => (
              <li key={e.id}>
                {formatDateTime(e.created_at)}: {isAbove(e) ? "above" : "below"} threshold · log score{" "}
                <span className="num">{e.log_score !== null ? e.log_score.toFixed(3) : "—"}</span> / threshold{" "}
                <span className="num">{e.threshold.toFixed(3)}</span> · {e.sensitivity === "high" ? "High" : "Standard"}
              </li>
            ))}
          </ul>
        </div>
      )}
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
  );
}
