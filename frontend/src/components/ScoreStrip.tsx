import type { CSSProperties } from "react";

type Props = { logScore: number; threshold: number; plain?: boolean };

// Where a recording's log score sits relative to this machine's baseline
// threshold, on a log-score axis centred on the threshold. The region above
// the threshold is hatched. It shows a position, not a probability or a
// health level; the caption says the same thing in words. With `plain`, the
// numbers are left out (they are in the result's technical details).
export function ScoreStrip({ logScore, threshold, plain = false }: Props) {
  const distance = logScore - threshold;
  const span = Math.max(Math.abs(distance) * 1.6, 0.25);
  const pct = (v: number) => ((v - (threshold - span)) / (2 * span)) * 100;
  const score = Math.min(Math.max(pct(logScore), 2), 98);
  const above = distance > 0;
  const caption = plain
    ? above
      ? "This recording sits past this machine's threshold, on the unusual side."
      : "This recording sits within this machine's threshold, on the normal side."
    : `Log score ${logScore.toFixed(3)} is ${Math.abs(distance).toFixed(3)} ${
        above ? "above" : "below"
      } this machine's baseline threshold of ${threshold.toFixed(3)}.`;

  return (
    <figure className="score-strip">
      <div className="strip" role="img" aria-label={caption}>
        <span className="strip-side strip-below">{plain ? "similar to normal" : "below"}</span>
        <span className="strip-side strip-above">{plain ? "unusual" : "above"}</span>
        <span className="strip-zone" style={{ left: "50%" }} />
        <span className="strip-track" />
        <span className="strip-threshold" style={{ left: "50%" }} />
        <span className="strip-threshold-label num">{plain ? "threshold" : `threshold ${threshold.toFixed(3)}`}</span>
        <span className="strip-marker" style={{ "--x": `${score}%` } as CSSProperties}>
          {!plain && <span className="strip-value num">{logScore.toFixed(3)}</span>}
        </span>
      </div>
      <figcaption aria-hidden="true">{caption}</figcaption>
    </figure>
  );
}
