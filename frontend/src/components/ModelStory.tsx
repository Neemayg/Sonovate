import type { CSSProperties } from "react";
import { SignalBars } from "./Decor";

// "The model" on the landing page: a pinned section that steps through the
// five stages of an analysis as the visitor scrolls (LandingEffects sets the
// active step). Each stage has an illustration on the side. The pictures are
// schematic and labelled as such; the facts in the text are the product's
// documented behaviour (ADR-008, ADR-009, EXP-007, EXP-010).

export const STORY_STEPS: { title: string; detail: string }[] = [
  {
    title: "10-second recording",
    detail: "A 16 kHz WAV clip of the machine running, checked in the browser and again on the server.",
  },
  {
    title: "Frozen AST encoder",
    detail: "A pretrained Audio Spectrogram Transformer reads the clip's spectrogram and turns it into an embedding. Its weights are never changed.",
  },
  {
    title: "Distance to baseline",
    detail: "The embedding is compared with the embeddings of this machine's own baseline recordings. The nearest-neighbour distance is the anomaly score.",
  },
  {
    title: "Per-machine threshold",
    detail: "A threshold set from the baseline's own scores decides whether the new recording reads as above or below it.",
  },
  {
    title: "Machine alert",
    detail: "When at least 2 of the last 3 analyses are above the threshold, the machine gets an alert worth checking. Not a diagnosis.",
  },
];

// Deterministic spectrogram intensities (no randomness).
const SPEC = Array.from({ length: 12 * 8 }, (_, i) => {
  const x = i % 12;
  const y = Math.floor(i / 12);
  const v = 0.5 + 0.3 * Math.sin(x * 0.9 + y * 0.6) + 0.2 * Math.sin(x * 2.3 - y * 1.7);
  return Math.max(0.08, Math.min(1, v * (1 - y * 0.07)));
});

const EMBED = Array.from({ length: 16 }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin(i * 1.7 + 0.4)));

// Ten baseline points in a loose cluster, and the new recording's point.
const BASE_POINTS = Array.from({ length: 10 }, (_, i) => {
  const a = i * 2.39996;
  const r = 22 + 44 * Math.sqrt((i + 0.5) / 10);
  return { x: 150 + Math.cos(a) * r, y: 135 + Math.sin(a) * r * 0.8 };
});
const NEW_POINT = { x: 350, y: 70 };
const NEAREST = BASE_POINTS.reduce((best, p) =>
  Math.hypot(p.x - NEW_POINT.x, p.y - NEW_POINT.y) < Math.hypot(best.x - NEW_POINT.x, best.y - NEW_POINT.y) ? p : best,
);

const BASE_TICKS = [12, 18, 22, 27, 31, 35, 38, 42, 45, 49];

function SceneRecording() {
  return (
    <div className="scene-body scene-rec">
      <div className="scene-file">
        <span className="scene-file-icon" aria-hidden="true">
          WAV
        </span>
        <span>
          <strong>recording.wav</strong>
          <span className="num">10 s × 16 kHz = 160,000 samples</span>
        </span>
      </div>
      <div className="scene-wave">
        <SignalBars count={64} seed={3.1} />
        <span className="scene-scan" />
      </div>
      <ul className="scene-checks">
        {["WAV, PCM or float", "16 kHz", "10 seconds", "Up to 2 MiB"].map((c, i) => (
          <li key={c} style={{ "--i": i } as CSSProperties}>
            <span aria-hidden="true">✓</span>
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SceneEncoder() {
  return (
    <div className="scene-body scene-enc">
      <div className="enc-col">
        <div className="enc-spec">
          {SPEC.map((v, i) => (
            <span key={i} style={{ "--v": v.toFixed(2), "--i": i % 12 } as CSSProperties} />
          ))}
        </div>
        <span className="scene-label">Spectrogram patches</span>
      </div>
      <span className="enc-arrow" />
      <div className="enc-col">
        <div className="enc-model">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} style={{ "--i": i } as CSSProperties} />
          ))}
          <strong>AST</strong>
          <em>frozen · pretrained</em>
        </div>
        <span className="scene-label">Transformer</span>
      </div>
      <span className="enc-arrow" />
      <div className="enc-col">
        <div className="enc-vector">
          {EMBED.map((v, i) => (
            <span key={i} style={{ "--v": v.toFixed(2), "--i": i } as CSSProperties} />
          ))}
        </div>
        <span className="scene-label">Embedding</span>
      </div>
    </div>
  );
}

function SceneDistance() {
  return (
    <div className="scene-body scene-dist">
      <svg viewBox="0 0 440 260" className="dist-plot">
        <ellipse cx="150" cy="135" rx="100" ry="78" className="dist-cluster" />
        {BASE_POINTS.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="6" className="dist-base" style={{ "--i": i } as CSSProperties} />
        ))}
        <line x1={NEW_POINT.x} y1={NEW_POINT.y} x2={NEAREST.x} y2={NEAREST.y} className="dist-line" pathLength={1} />
        <circle cx={NEW_POINT.x} cy={NEW_POINT.y} r="8" className="dist-new" />
        <text x={NEW_POINT.x} y={NEW_POINT.y - 18} textAnchor="middle" className="dist-text">
          new recording
        </text>
        <text x="150" y="240" textAnchor="middle" className="dist-text">
          10 baseline recordings
        </text>
        <text
          x={(NEW_POINT.x + NEAREST.x) / 2 + 14}
          y={(NEW_POINT.y + NEAREST.y) / 2 + 22}
          className="dist-text dist-text-accent"
        >
          distance = score
        </text>
      </svg>
    </div>
  );
}

function SceneThreshold() {
  return (
    <div className="scene-body scene-thr">
      <div className="thr-axis">
        <span className="thr-zone" />
        {BASE_TICKS.map((x, i) => (
          <span key={i} className="thr-tick" style={{ left: `${x}%`, "--i": i } as CSSProperties} />
        ))}
        <span className="thr-line" />
        <span className="thr-marker" />
        <span className="thr-side thr-below">below</span>
        <span className="thr-side thr-above">above</span>
      </div>
      <div className="thr-legend">
        <span>
          <i className="thr-key-tick" /> baseline scores
        </span>
        <span>
          <i className="thr-key-line" /> threshold
        </span>
        <span>
          <i className="thr-key-marker" /> new recording
        </span>
      </div>
    </div>
  );
}

function SceneAlert() {
  const runs = [
    { label: "Analysis 1", above: true },
    { label: "Analysis 2", above: false },
    { label: "Analysis 3", above: true },
  ];
  return (
    <div className="scene-body scene-alert">
      <div className="alert-runs">
        {runs.map((r, i) => (
          <div key={r.label} className={`alert-run${r.above ? " is-above" : ""}`} style={{ "--i": i } as CSSProperties}>
            <span className="scene-label">{r.label}</span>
            <strong>{r.above ? "Above" : "Below"}</strong>
          </div>
        ))}
      </div>
      <div className="alert-rule">
        <span className="num">2 of the last 3 above</span>
        <span className="alert-badge">
          <span aria-hidden="true" />
          Machine alert · worth checking
        </span>
      </div>
    </div>
  );
}

const SCENES = [SceneRecording, SceneEncoder, SceneDistance, SceneThreshold, SceneAlert];

export function ModelStory() {
  return (
    <section id="model" className="story l-section-alt" aria-labelledby="model-title" data-steps={STORY_STEPS.length}>
      <div className="story-sticky">
        <div className="l-container story-layout">
          <div className="story-copy">
            <p className="eyebrow">The model</p>
            <h2 id="model-title">
              A pretrained ear, tuned to <em>one machine</em> at a time.
            </h2>
            <div className="story-steps-wrap">
              <span className="story-rail" aria-hidden="true">
                <span />
              </span>
              <ol className="story-steps">
              {STORY_STEPS.map((s, i) => (
                <li key={s.title} className={`story-step${i === 0 ? " is-active" : ""}`} data-story-step={i}>
                  <button type="button" className="story-step-button" data-story-goto={i}>
                    <span className="story-n num">{String(i + 1).padStart(2, "0")}</span>
                    <span className="story-text">
                      <strong>{s.title}</strong>
                      <span>{s.detail}</span>
                    </span>
                  </button>
                </li>
              ))}
              </ol>
            </div>
          </div>

          <figure className="story-stage" aria-label="Illustration of the current analysis stage. Not real data.">
            <div className="story-stage-head" aria-hidden="true">
              <span className="eyebrow">
                Stage <span className="story-stage-n num">1</span> / {STORY_STEPS.length}
              </span>
              <span className="tag tag-illustration">Illustration</span>
            </div>
            <div className="story-scenes" aria-hidden="true">
              {SCENES.map((Scene, i) => (
                <div key={i} className={`scene${i === 0 ? " is-active" : ""}`} data-scene={i}>
                  <p className="scene-title">{STORY_STEPS[i].title}</p>
                  <Scene />
                </div>
              ))}
            </div>
            <div className="story-progress" aria-hidden="true">
              {STORY_STEPS.map((s, i) => (
                <span key={s.title} className={i === 0 ? "is-active" : undefined} data-story-dot={i} />
              ))}
            </div>
            <figcaption className="story-note">
              Operating context such as speed or load is stored with every recording. In our experiments it did not improve
              detection, so the current model listens to audio only.
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
