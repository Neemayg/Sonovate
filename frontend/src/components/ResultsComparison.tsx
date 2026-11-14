"use client";

// One machine's analysed checks on one chart: one marker per check at its
// stored recording-level score, and the threshold that was applied to each
// check. Only stored values are drawn; nothing is interpolated, smoothed or
// estimated. Window-level scores are never shown here (they live on each
// recording's page), so the chart only holds recording-level results.

import Link from "next/link";
import { useId, useState, type CSSProperties } from "react";
import { formatDuration } from "@/lib/monitoring";
import {
  ABOVE_LABEL,
  ABOVE_MEANING,
  WITHIN_LABEL,
  WITHIN_MEANING,
  matchesResultFilter,
  resultSummary,
  thresholdVaries,
  type CheckResult,
  type ResultFilter,
} from "@/lib/results";
import { formatDateTime } from "./Status";

const FILTERS: { id: ResultFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "above", label: ABOVE_LABEL },
  { id: "within", label: WITHIN_LABEL },
];

export function checkName(r: Pick<CheckResult, "number">): string {
  return r.number > 0 ? `Check ${r.number}` : "Check";
}

function lengthText(r: CheckResult): string {
  const windows = `${r.windowCount} × 10 s window${r.windowCount === 1 ? "" : "s"}`;
  return r.durationSeconds ? `${formatDuration(r.durationSeconds)} · ${windows}` : windows;
}

/** Up to five round tick values covering [lo, hi]. */
function ticks(lo: number, hi: number): number[] {
  const raw = (hi - lo) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

export function Marker({ above }: { above: boolean }) {
  return (
    <svg className="rc-shape" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      {above ? <path d="M7 1.2 13 12.4H1L7 1.2Z" /> : <circle cx="7" cy="7" r="5.2" />}
    </svg>
  );
}

type Props = {
  results: CheckResult[];
  /** The recording being viewed, highlighted and not linked. */
  currentId?: string;
  /** Rows shown in the list under the chart before "Show all". */
  listLimit?: number;
};

export function ResultsComparison({ results, currentId, listLimit = 8 }: Props) {
  const uid = useId();
  const [filter, setFilter] = useState<ResultFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const summary = resultSummary(results);

  if (results.length === 0) {
    return (
      <div className="rc-empty">
        <p className="rc-headline">{summary.headline}</p>
        <p className="muted small">{summary.interpretation}</p>
      </div>
    );
  }

  const values = results.flatMap((r) => [r.logScore, r.threshold]);
  const lo0 = Math.min(...values);
  const hi0 = Math.max(...values);
  const pad = Math.max((hi0 - lo0) * 0.18, 0.15);
  const lo = lo0 - pad;
  const hi = hi0 + pad;
  const y = (v: number) => 100 - ((v - lo) / (hi - lo)) * 100;
  const n = results.length;
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const varies = thresholdVaries(results);

  // Threshold as a step line: flat across each check's column at the
  // threshold applied to that check.
  const step = results
    .map((r, i) => {
      const x0 = (i / n) * 100;
      const x1 = ((i + 1) / n) * 100;
      return `${i === 0 ? "M" : "L"}${x0} ${y(r.threshold)} L${x1} ${y(r.threshold)}`;
    })
    .join(" ");

  const labelEvery = n <= 12 ? 1 : Math.ceil(n / 12);
  const visible = results.filter((r) => matchesResultFilter(r, filter));
  const listed = [...visible].reverse();
  const shown = showAll ? listed : listed.slice(0, listLimit);
  const counts: Record<ResultFilter, number> = { all: summary.analysed, above: summary.above, within: summary.within };

  return (
    <div className="rc">
      <div className="rc-summary">
        <p className="rc-headline">{summary.headline}</p>
        <p className="rc-interpretation">{summary.interpretation}</p>
        <dl className="rc-counts">
          <div>
            <dt>Analysed</dt>
            <dd className="num">{summary.analysed}</dd>
          </div>
          <div className="is-above">
            <dt>{ABOVE_LABEL}</dt>
            <dd className="num">{summary.above}</dd>
          </div>
          <div>
            <dt>{WITHIN_LABEL}</dt>
            <dd className="num">{summary.within}</dd>
          </div>
        </dl>
      </div>

      <div className="rc-toolbar">
        <div className="filters" role="group" aria-label="Show checks">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <span className="num">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <ul className="rc-legend" aria-label="Legend">
          <li>
            <span className="rc-key is-above">
              <Marker above />
            </span>
            {ABOVE_LABEL}
          </li>
          <li>
            <span className="rc-key is-within">
              <Marker above={false} />
            </span>
            {WITHIN_LABEL}
          </li>
          <li>
            <span className="rc-key-line" aria-hidden="true" />
            Threshold {varies ? "for each check" : ""}
          </li>
          {currentId && (
            <li>
              <span className="rc-key is-current" aria-hidden="true" />
              This recording
            </li>
          )}
        </ul>
      </div>

      <figure className="rc-figure">
        <div className="rc-chart">
          <div className="rc-yaxis" aria-hidden="true">
            {ticks(lo, hi).map((t) => (
              <span key={t} className="num" style={{ top: `${y(t)}%` }}>
                {t.toFixed(2)}
              </span>
            ))}
          </div>
          <div className="rc-plot">
            <svg className="rc-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              {ticks(lo, hi).map((t) => (
                <line key={t} className="rc-grid" x1="0" x2="100" y1={y(t)} y2={y(t)} vectorEffect="non-scaling-stroke" />
              ))}
              <path className="rc-threshold" d={step} vectorEffect="non-scaling-stroke" />
            </svg>
            <span className="rc-threshold-tag small" style={{ top: `${y(results[0].threshold)}%` }} aria-hidden="true">
              threshold
            </span>
            <ol className="rc-markers" aria-label="Checks on the chart, oldest first">
              {results.map((r, i) => {
                const dim = !matchesResultFilter(r, filter);
                const current = r.recordingId === currentId;
                const tipId = `${uid}-tip-${i}`;
                const px = x(i);
                const py = y(r.logScore);
                const label = `${checkName(r)}: ${r.above ? ABOVE_LABEL : WITHIN_LABEL}. Score ${r.logScore.toFixed(2)}, threshold ${r.threshold.toFixed(2)}. Recorded ${formatDateTime(r.recordedAt)}.`;
                const cls = `rc-marker ${r.above ? "is-above" : "is-within"}${dim ? " is-dim" : ""}${current ? " is-current" : ""}${
                  px > 66 ? " tip-left" : px < 34 ? " tip-right" : ""
                }${py < 38 ? " tip-below" : ""}`;
                const tip = (
                  <span id={tipId} role="tooltip" className="rc-tip">
                    <strong>
                      {checkName(r)}
                      {current ? " · this recording" : ""}
                    </strong>
                    <span className={r.above ? "rc-tip-above" : undefined}>
                      {r.above ? `${ABOVE_LABEL}: ${ABOVE_MEANING.toLowerCase()}` : `${WITHIN_LABEL}: ${WITHIN_MEANING.toLowerCase()}`}
                    </span>
                    <span className="num">
                      Score {r.logScore.toFixed(2)} · threshold {r.threshold.toFixed(2)}
                    </span>
                    <span>Recorded {formatDateTime(r.recordedAt)}</span>
                    <span className="muted">
                      {lengthText(r)}
                      {r.sensitivity === "high" ? " · High sensitivity" : ""}
                    </span>
                    {!current && <span className="muted">Select to open</span>}
                  </span>
                );
                const style = { left: `${px}%`, top: `${py}%` } as CSSProperties;
                return (
                  <li key={r.recordingId} className={cls} style={style} aria-hidden={dim || undefined}>
                    {current ? (
                      <span className="rc-hit" role="img" tabIndex={dim ? -1 : 0} aria-label={`${label} This recording.`} aria-describedby={tipId}>
                        <Marker above={r.above} />
                      </span>
                    ) : (
                      <Link
                        href={`/recordings/${r.recordingId}`}
                        className="rc-hit"
                        tabIndex={dim ? -1 : undefined}
                        aria-label={`${label} Open ${checkName(r)}.`}
                        aria-describedby={tipId}
                      >
                        <Marker above={r.above} />
                      </Link>
                    )}
                    {tip}
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="rc-xaxis" aria-hidden="true">
            {results.map((r, i) =>
              i % labelEvery === 0 || i === n - 1 ? (
                <span key={r.recordingId} className={`num${r.recordingId === currentId ? " is-current" : ""}`} style={{ left: `${x(i)}%` }}>
                  {r.number || i + 1}
                </span>
              ) : null,
            )}
          </div>
        </div>
        <figcaption className="muted small">
          Each marker is one analysed check, numbered in upload order. Higher means it sounded less like this
          machine&apos;s baseline recordings. The score is the recording&apos;s average over its 10-second windows; it is
          not a probability or a health level.
          {varies &&
            " The threshold can differ between checks: it depends on the recording's length, the sensitivity setting and the baseline at the time."}
        </figcaption>
      </figure>

      <div className="rc-list-wrap">
        <h3 className="rc-list-title">
          {filter === "above" ? "Checks above threshold" : filter === "within" ? "Checks within threshold" : "All analysed checks"}
          <span className="muted small"> · newest first</span>
        </h3>
        {visible.length === 0 ? (
          <p className="muted small">No checks match this filter.</p>
        ) : (
          <ul className="rc-list">
            {shown.map((r) => {
              const current = r.recordingId === currentId;
              const body = (
                <>
                  <span className={`rc-key ${r.above ? "is-above" : "is-within"}`}>
                    <Marker above={r.above} />
                  </span>
                  <span className="rc-row-name">
                    <strong>{checkName(r)}</strong>
                    <span className="muted small">{formatDateTime(r.recordedAt)}</span>
                  </span>
                  <span className={`decision-pill${r.above ? " is-above" : ""}`}>{r.above ? ABOVE_LABEL : WITHIN_LABEL}</span>
                  <span className="rc-row-score num small">
                    {r.logScore.toFixed(2)} <span className="muted">/ {r.threshold.toFixed(2)}</span>
                  </span>
                  <span className="rc-row-open small">{current ? "Viewing" : "Open"}</span>
                </>
              );
              return (
                <li key={r.recordingId} className={current ? "is-current" : undefined}>
                  {current ? (
                    <span className="rc-row" aria-current="page">
                      {body}
                    </span>
                  ) : (
                    <Link href={`/recordings/${r.recordingId}`} className="rc-row">
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="muted small rc-list-note">Score / threshold, on the same scale as the chart.</p>
        {listed.length > listLimit && (
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Show fewer" : `Show all ${listed.length}`}
          </button>
        )}
      </div>
    </div>
  );
}
