import type { CSSProperties, ReactNode } from "react";
import { Brand } from "@/components/Brand";
import { SignalBars, SignalTrace } from "@/components/Decor";
import { LandingEffects } from "@/components/LandingEffects";
import { ModelStory } from "@/components/ModelStory";
import { SessionCta } from "@/components/SessionCta";

// Public landing page. Every figure here is a documented result:
// EXP-009 in docs/EXPERIMENT_LOG.md (untouched DCASE 2022 evaluation
// sections 03-05) and the product rules in docs/DECISIONS.md. The hero
// instrument is a labelled illustration, not a reading.

const STEPS = [
  {
    n: "01",
    title: "Register a machine",
    body: "Add a bearing or gearbox with its name and location. Each machine is compared only with itself, never with a fleet average.",
  },
  {
    n: "02",
    title: "Record its normal sound",
    body: "Upload 10 baseline recordings while it runs as expected: 10-second, 16 kHz WAV clips, with optional operating context such as speed or load.",
  },
  {
    n: "03",
    title: "Compare what comes next",
    body: "Each new recording is placed against that machine's own baseline threshold. Repeated results above it raise a machine alert worth checking.",
  },
];

const STATS: { value: string; label: string; note: string }[] = [
  { value: "0.678", label: "Mean AUC", note: "Over 12 section-domains, versus 0.650 for the autoencoder baseline" },
  { value: "+0.028", label: "AUC over baseline", note: "95% interval +0.001 to +0.055" },
  { value: "2–9%", label: "False alarms", note: "At the baseline-calibrated threshold" },
  { value: "4–23%", label: "Anomalies caught", note: "At that same threshold: most faults are missed" },
];

const LIMITS = [
  { title: "Not a diagnosis", body: "It says a recording sounds unlike the baseline. It does not name a fault, a part or a cause." },
  { title: "Not a probability", body: "Anomaly scores are distances, not chances of failure, and are never shown as health percentages." },
  { title: "Not a failure forecast", body: "No remaining-useful-life estimate and no guaranteed warning before a breakdown." },
  { title: "Low sensitivity", body: "At a low false-alarm rate it misses most faults. No alert does not mean no fault." },
];

// Skips the intro on a second visit in the same tab. Runs before first paint;
// the class it adds is the only effect, and storage errors are ignored.
const INTRO_SCRIPT = `try{var k="sonovate-intro";if(sessionStorage.getItem(k)){document.documentElement.classList.add("intro-seen")}else{sessionStorage.setItem(k,"1")}}catch(e){}`;

function delay(ms: number): CSSProperties {
  return { "--d": `${ms}ms` } as CSSProperties;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="l-icon">
      {children}
    </svg>
  );
}

const STEP_ICONS = [
  <Icon key="a">
    <rect x="3" y="5" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="7.5" cy="10" r="1.6" fill="currentColor" />
    <path d="M11 9h3.5M11 11.5h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </Icon>,
  <Icon key="b">
    <path d="M3 10h1.5M6 7v6M9 4v12M12 6.5v7M15 8.5v3M17 10h0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </Icon>,
  <Icon key="c">
    <path d="M3 14.5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M10 3.5v8" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.5 2" />
    <circle cx="13.5" cy="9" r="2" fill="currentColor" />
  </Icon>,
];

function Intro() {
  return (
    <div className="intro" aria-hidden="true">
      <div className="intro-inner">
        <div className="intro-bars">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} style={{ "--i": i } as CSSProperties} />
          ))}
        </div>
        <p className="intro-word">
          {"SONOVATE".split("").map((ch, i) => (
            <span key={i} style={{ "--i": i } as CSSProperties}>
              {ch}
            </span>
          ))}
        </p>
        <span className="intro-line" />
        <p className="intro-sub">Listening for change</p>
      </div>
    </div>
  );
}

function HeroInstrument() {
  return (
    <figure
      className="instrument tilt"
      aria-label="Illustration of how a recording is compared with a baseline. Not real data."
    >
      <div className="instrument-head">
        <div>
          <p className="eyebrow">Comparison view</p>
          <p className="instrument-title">Recording vs. baseline</p>
        </div>
        <span className="tag tag-illustration">Illustration</span>
      </div>

      <div className="instrument-wave">
        <SignalBars count={84} seed={0.6} />
        <span className="instrument-playhead" aria-hidden="true" />
      </div>
      <div className="instrument-axis num" aria-hidden="true">
        <span>0 s</span>
        <span>5 s</span>
        <span>10 s</span>
      </div>

      <div className="instrument-grid" aria-hidden="true">
        <div>
          <span className="eyebrow">Baseline</span>
          <span className="instrument-meter">
            {Array.from({ length: 10 }, (_, i) => (
              <i key={i} style={{ animationDelay: `calc(var(--intro, 0ms) + ${300 + i * 70}ms)` }} />
            ))}
          </span>
        </div>
        <div>
          <span className="eyebrow">Encoder</span>
          <strong>Frozen AST</strong>
        </div>
        <div>
          <span className="eyebrow">Threshold</span>
          <strong>Per machine</strong>
        </div>
      </div>

      <div className="instrument-strip" aria-hidden="true">
        <span className="strip-side strip-below">Below</span>
        <span className="strip-side strip-above">Above</span>
        <span className="instrument-track" />
        <span className="instrument-zone" />
        <span className="instrument-threshold" />
        <span className="instrument-marker" />
      </div>
      <figcaption className="instrument-caption">
        Shapes are drawn for illustration. Real results appear only after you upload recordings.
      </figcaption>
    </figure>
  );
}

export default function Landing() {
  return (
    <div className="landing theme-dark">
      <script dangerouslySetInnerHTML={{ __html: INTRO_SCRIPT }} />
      <Intro />
      <LandingEffects />
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="l-nav">
        <span className="scroll-progress" aria-hidden="true" />
        <div className="l-container l-nav-inner">
          <Brand href="/" />
          <nav aria-label="Sections" className="l-nav-links">
            <a href="#how">How it works</a>
            <a href="#model">The model</a>
            <a href="#evaluation">Evaluation</a>
            <a href="#limits">Limits</a>
          </nav>
          <div className="l-nav-cta">
            <SessionCta variant="nav" />
          </div>
        </div>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-glow" aria-hidden="true" />
          <div className="hero-grid-bg" aria-hidden="true" />
          <div className="hero-grid-spot" aria-hidden="true" />
          <span className="hero-cell" aria-hidden="true" />
          <div className="l-container hero-layout">
            <div className="hero-copy">
              <p className="pill">
                <span className="pill-dot" aria-hidden="true" />
                Research prototype · bearings &amp; gearboxes
              </p>
              <h1 id="hero-title">
                Hear what <em>changed</em> in a machine&apos;s sound.
              </h1>
              <p className="lead">
                Sonovate learns how each machine sounds when it runs normally, then shows whether a new recording sits
                above or below that machine&apos;s own baseline. Acoustic screening, honestly labelled.
              </p>
              <div className="hero-cta">
                <SessionCta variant="hero" />
                <a href="#how" className="btn btn-ghost btn-lg">
                  See how it works
                </a>
              </div>
              <dl className="hero-facts">
                <div>
                  <dt>Clip length</dt>
                  <dd className="num">10 s</dd>
                </div>
                <div>
                  <dt>Sample rate</dt>
                  <dd className="num">16 kHz</dd>
                </div>
                <div>
                  <dt>Baseline</dt>
                  <dd className="num">10 clips</dd>
                </div>
              </dl>
            </div>
            <HeroInstrument />
          </div>
          <a href="#how" className="scroll-cue" aria-label="Scroll to how it works">
            <span />
          </a>
        </section>

        <section id="how" className="l-section" aria-labelledby="how-title">
          <div className="l-container">
            <div className="l-section-head" data-reveal>
              <p className="eyebrow">How it works</p>
              <h2 id="how-title">
                Three steps from first clip to <em>first comparison.</em>
              </h2>
            </div>
            <div className="steps-wrap" data-reveal>
              <span className="steps-rail" aria-hidden="true">
                <span />
              </span>
              <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s.n} className="step spot" data-reveal style={delay(i * 140)}>
                  <span className="step-watermark num" aria-hidden="true">
                    {s.n}
                  </span>
                  <div className="step-top">
                    {STEP_ICONS[i]}
                    <span className="step-n num">Step {s.n}</span>
                  </div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
              </ol>
            </div>
          </div>
        </section>

        <ModelStory />

        <section id="evaluation" className="l-section" aria-labelledby="eval-title">
          <div className="l-container">
            <div className="l-section-head l-section-head-wide" data-reveal>
              <p className="eyebrow">Evaluation</p>
              <h2 id="eval-title">
                Measured on recordings it had <em>never heard.</em>
              </h2>
              <p className="l-body">
                The final test used DCASE 2022 evaluation data (sections 03–05) that stayed untouched until the model was
                chosen. These are the numbers, including the weak ones.
              </p>
            </div>
            <ul className="stats">
              {STATS.map((s, i) => (
                <li key={s.label} className="stat spot" data-reveal style={delay(i * 110)}>
                  <span className="stat-value num" aria-hidden="true" data-countup={s.value}>
                    {s.value}
                  </span>
                  <span className="visually-hidden">{s.value}</span>
                  <span className="stat-label">{s.label}</span>
                  <span className="stat-note">{s.note}</span>
                </li>
              ))}
            </ul>
            <p className="l-footnote" data-reveal>
              Gearbox AUC 0.730 vs 0.654. Bearing 0.626 vs 0.646: not improved over the baseline. AUC measures ranking,
              not accuracy, and anomaly scores are not failure probabilities.
            </p>
          </div>
        </section>

        <section id="limits" className="l-section l-section-alt" aria-labelledby="limits-title">
          <div className="l-container">
            <div className="l-section-head" data-reveal>
              <p className="eyebrow">Limits</p>
              <h2 id="limits-title">
                What Sonovate will <em>not</em> tell you.
              </h2>
            </div>
            <ul className="limits-grid">
              {LIMITS.map((l, i) => (
                <li key={l.title} className="spot" data-reveal style={delay(i * 110)}>
                  <h3>{l.title}</h3>
                  <p>{l.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="l-cta" aria-labelledby="cta-title">
          <div className="l-container l-cta-inner" data-reveal>
            <SignalTrace className="l-cta-trace" />
            <h2 id="cta-title">Start with one machine and ten normal recordings.</h2>
            <p className="l-body">Your machines, recordings and results are visible only to you.</p>
            <div className="hero-cta">
              <SessionCta variant="pair" />
            </div>
          </div>
        </section>
      </main>

      <footer className="l-footer">
        <div className="l-container l-footer-inner">
          <Brand href="/" />
          <p>Research prototype. Low sensitivity; not a diagnosis or failure prediction.</p>
        </div>
      </footer>
    </div>
  );
}
