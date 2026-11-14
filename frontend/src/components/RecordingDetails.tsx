// Shared display of a recording's operating context and stored results, used
// by the result page and the history table. Every sentence and figure comes
// from the stored prediction; nothing is estimated. Scores are positions
// against this machine's threshold, never probabilities or health levels.

import Link from "next/link";
import type { CSSProperties } from "react";
import type { ContextReading, Prediction } from "@/lib/api";
import { formatDuration } from "@/lib/monitoring";
import { ABOVE_LABEL, ABOVE_MEANING, WITHIN_LABEL, WITHIN_MEANING } from "@/lib/results";
import { Marker } from "./ResultsComparison";
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

/** One analysed check, in plain words first and with its stored numbers next to them. */
export function VerdictCard({ p, durationSeconds }: { p: Prediction; durationSeconds?: number | null }) {
  const above = isAbove(p);
  const high = p.sensitivity === "high";
  const logScore = p.log_score ?? (p.score > 0 ? Math.log(p.score) : null);
  return (
    <section className={`card verdict ${above ? "is-above" : "is-below"}`} aria-labelledby="verdict-title">
      <p className="eyebrow">What happened</p>
      <p className={`verdict-status ${above ? "is-above" : "is-within"}`}>
        <span className={`rc-key ${above ? "is-above" : "is-within"}`}>
          <Marker above={above} />
        </span>
        {above ? ABOVE_LABEL : WITHIN_LABEL}
      </p>
      <h2 id="verdict-title" className="verdict-title">
        {above ? `${ABOVE_MEANING}.` : `${WITHIN_MEANING}.`}
      </h2>
      <p className="verdict-body">
        {above
          ? "This recording sounded different from the normal recordings this machine was set up with. It is worth inspecting, but it does not confirm a fault."
          : "This recording stayed within the range expected from this machine's normal recordings. That does not mean the machine is healthy or fault-free."}
      </p>
      <dl className="verdict-facts">
        <div>
          <dt>Score</dt>
          <dd className="num">{logScore !== null ? logScore.toFixed(2) : "—"}</dd>
        </div>
        <div>
          <dt>Threshold for this recording</dt>
          <dd className="num">{p.threshold.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Analysed</dt>
          <dd>{formatDateTime(p.created_at)}</dd>
        </div>
        <div>
          <dt>Judged on</dt>
          <dd>
            {durationSeconds ? `${formatDuration(durationSeconds)}, ` : ""}
            {p.window_count} × 10 s window{p.window_count === 1 ? "" : "s"}
          </dd>
        </div>
      </dl>
      {logScore !== null && <ScoreStrip logScore={logScore} threshold={p.threshold} plain />}
      <p className="muted small">
        The score is this recording&apos;s average over its 10-second windows; above the threshold means unusual for this
        machine. {SCORE_NOTE}
        {high && " This machine uses High sensitivity, which flags more recordings, including more normal ones."}
      </p>
    </section>
  );
}

// --- C. per-window scores -----------------------------------------------------------

/** The stored per-window log scores, or the single score for a 10 s recording. */
export function windowScores(p: Prediction): number[] {
  if (p.window_log_scores && p.window_log_scores.length > 0) return p.window_log_scores;
  return p.log_score !== null ? [p.log_score] : [];
}

// One bar per 10 s window from the stored scores. The decision is made on the
// average of the windows (ADR-012), so bars are drawn in one neutral colour and
// are never marked above or below on their own; the threshold line is labelled
// as applying to the average. A tall bar does not locate a physical fault.
export function WindowChart({ p }: { p: Prediction }) {
  const scores = windowScores(p);
  if (scores.length === 0) return null;
  const mean = p.log_score ?? scores.reduce((a, b) => a + b, 0) / scores.length;
  const values = [...scores, p.threshold, mean];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.25, 0.25);
  const min = lo - pad;
  const max = hi + pad;
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const single = scores.length === 1;
  const label = scores.map((v, i) => `${i * 10} to ${i * 10 + 10} seconds: ${v.toFixed(2)}`).join("; ");

  return (
    <details className="card technical-card windows-card">
      <summary>
        Inside this recording: {scores.length} ten-second window{single ? "" : "s"}
      </summary>
      <p className="muted small">
        {single
          ? "This recording has one 10-second window, so its window score is the recording's score."
          : "The result above is decided on the average of these windows, not on any single window. Individual windows are not judged against the threshold."}
      </p>
      <div className="wchart" role="img" aria-label={`Window scores: ${label}. Average ${mean.toFixed(2)}; threshold for the average ${p.threshold.toFixed(2)}.`}>
        <div className="wchart-plot" style={{ "--thr": `${pct(p.threshold)}%`, "--avg": `${pct(mean)}%` } as CSSProperties}>
          <span className="wchart-threshold" aria-hidden="true">
            <span>threshold (for the average) {p.threshold.toFixed(2)}</span>
          </span>
          {!single && (
            <span className="wchart-mean" aria-hidden="true">
              <span>average {mean.toFixed(2)}</span>
            </span>
          )}
          {scores.map((v, i) => (
            <div key={i} className="wchart-col">
              <span className="wchart-value num" aria-hidden="true" style={{ bottom: `${Math.max(2, pct(v))}%` } as CSSProperties}>
                {v.toFixed(2)}
              </span>
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
        Taller bars sounded less like this machine&apos;s normal recordings. The bars do not show where a fault is.
      </p>
    </details>
  );
}

// --- D. what it means and what to do next ---------------------------------------------

export function NextStepsCard({
  p,
  machineId,
  recordingId,
}: {
  p: Prediction;
  machineId?: string;
  recordingId?: string;
}) {
  const above = isAbove(p);
  const baselines = p.baseline_count ?? 0;
  const meaning = above
    ? "Compared with this machine's own normal recordings, this one sounded unusual. A single unusual check can have ordinary causes, such as a different operating setting, background noise or a moved microphone. A machine alert is raised only when at least 2 of the last 3 checks are above threshold."
    : "This analysis did not flag the recording as unusual for this machine. The detector misses many faults, so keep up normal inspections and regular checks.";
  const steps = above
    ? [
        "Listen to this recording next to a normal reference (Listen & compare below).",
        "Inspect the machine using your normal maintenance procedures.",
        "Record another check under the same operating conditions to see whether it repeats.",
      ]
    : [
        "Continue normal inspections.",
        "Keep recording conditions consistent: same position, distance and operating setting.",
        "Analyse another recording at your usual interval.",
      ];
  const tips: string[] = [];
  if (p.window_count < 6) tips.push("Record 60 seconds next time: longer recordings catch more unusual sounds.");
  if (baselines > 0 && baselines < 30) {
    tips.push(`Adding normal recordings (${30 - baselines} more for the recommended 30) widens the baseline's coverage.`);
  }
  return (
    <section className="card next-steps" aria-labelledby="meaning-title">
      <h2 id="meaning-title">What it means</h2>
      <p>{meaning}</p>
      <h2 id="next-steps-title" className="next-steps-heading">
        What to do next
      </h2>
      <ol className="next-steps-list" aria-labelledby="next-steps-title">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {tips.length > 0 && (
        <ul className="small muted">
          {tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {machineId && (
        <div className="actions">
          {above && recordingId && (
            <a href="#listen" className="btn btn-sm btn-primary">
              Listen &amp; compare
            </a>
          )}
          <Link href={`/machines/${machineId}#check`} className={`btn btn-sm ${above ? "btn-outline" : "btn-primary"}`}>
            Analyse another recording
          </Link>
          <Link href="/machines" className="btn btn-sm btn-quiet">
            Back to dashboard
          </Link>
        </div>
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
        <dd>{isAbove(p) ? "Above this machine's baseline threshold" : "Within (at or below) this machine's baseline threshold"}</dd>
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
                {formatDateTime(e.created_at)}: {isAbove(e) ? "above" : "within"} threshold · log score{" "}
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
