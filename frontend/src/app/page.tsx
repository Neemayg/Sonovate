import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { SignalBars, SignalTrace } from "@/components/Decor";
import { LandingEffects } from "@/components/LandingEffects";
import { ModelStory } from "@/components/ModelStory";
import { SessionCta } from "@/components/SessionCta";

// Public landing page. Product screenshots are real captures of this app
// (public/product/, demo account seeded from the MIMII DG dataset, CC-BY-4.0;
// no account details shown). No performance figures appear here: the
// supporting evaluations reuse held-out sets and pseudo-recordings, so they
// are described with their caveats in the user guide (/guide#evidence)
// instead of as headline numbers. Product rules: docs/DECISIONS.md.

const TITLE = "Sonovate — Acoustic Machine Monitoring";
const DESCRIPTION =
  "Monitor changes in industrial machine sounds using machine-specific acoustic baselines, audio analysis and transparent recording comparisons.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Sonovate",
    images: [{ url: "/product/og-image.jpg", width: 1200, height: 630, alt: "A Sonovate result page comparing a machine recording with its normal sound" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/product/og-image.jpg"],
  },
};

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

const PROBLEM = [
  {
    title: "Every machine sounds like itself",
    body: "Motors, pumps, fans and gear drives each produce a characteristic acoustic pattern while they run.",
  },
  {
    title: "That sound can change",
    body: "Wear, damage, loose parts or a change in how the machine runs can alter its sound, sometimes gradually.",
  },
  {
    title: "Small changes are easy to miss",
    body: "Listening on a walk-round depends on the person, the day and the noise around them, so small shifts are hard to judge consistently.",
  },
  {
    title: "A repeatable comparison",
    body: "Sonovate compares each new recording with that machine's own normal recordings, the same way every time.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Establish a baseline",
    body: "Register a bearing or gearbox and record it while it runs normally.",
    points: ["At least 10 normal recordings", "30 recommended for wider coverage", "Every machine gets its own reference"],
    icon: (
      <Icon>
        <path d="M3 10h1.5M6 7v6M9 4v12M12 6.5v7M15 8.5v3M17 10h0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </Icon>
    ),
  },
  {
    n: "02",
    title: "Record a check",
    body: "Upload a new audio recording, or a video with sound, from your phone or recorder.",
    points: ["Converted to audio in your browser", "60 seconds recommended (10–60 s accepted)", "No specialised hardware required"],
    icon: (
      <Icon>
        <rect x="6.5" y="2.5" width="7" height="11" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 10a6 6 0 0 0 12 0M10 16v2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </Icon>
    ),
  },
  {
    n: "03",
    title: "Understand the result",
    body: "Sonovate places the check against the machine's own threshold and helps you decide what to look at.",
    points: ["Above threshold: unusual, worth inspecting", "Below threshold: similar to normal", "Listen & compare, and history over time"],
    icon: (
      <Icon>
        <path d="M3 14.5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M10 3.5v8" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.5 2" />
        <circle cx="13.5" cy="9" r="2" fill="currentColor" />
      </Icon>
    ),
  },
];

const USPS: { title: string; body: string; tag?: string }[] = [
  {
    title: "Machine-specific baselines",
    body: "Each machine is compared only with its own normal recordings and gets its own threshold, calculated from those recordings.",
  },
  {
    title: "No specialised recording hardware",
    body: "Use compatible phone recordings or videos. Audio is converted to 16 kHz mono in your browser, and only that audio is uploaded.",
  },
  {
    title: "Listen & compare",
    body: "Play a check in sync with a normal reference, switch between them instantly, match loudness and see where the frequency profile differs.",
  },
  {
    title: "Longer acoustic checks",
    body: "A 60-second check is evaluated across six 10-second windows; the result uses their average and each window stays visible.",
  },
  {
    title: "Repeated-deviation alerts",
    body: "A machine alert needs at least 2 of its last 3 checks above threshold, so a single odd recording does not raise one.",
    tag: "Rule chosen on simulated timelines",
  },
  {
    title: "Traceable results",
    body: "Every result keeps its threshold, baseline count and model version. Browse a machine's history or export it as CSV.",
  },
  {
    title: "Private by design",
    body: "Audio is stored privately, each account's data is isolated in the database, and deleting your account removes your audio.",
  },
];

const HONESTY = [
  { title: "A research prototype", body: "Built and tested on lab recordings of bearings and gearboxes. Treat it as decision support." },
  { title: "Acoustic anomaly screening", body: "It tells you whether a recording sounds unlike the machine's normal sound, not what is wrong." },
  { title: "It can miss anomalies", body: "Many changes are not caught. No alert does not mean no fault." },
  { title: "It can flag normal recordings", body: "Some normal recordings land above the threshold. A second check helps." },
  { title: "Above threshold is not a confirmed fault", body: "It is a reason to inspect the machine with your usual procedures." },
  { title: "Below threshold is not a clean bill of health", body: "It means the recording is similar to the baseline, nothing more." },
];

type Shot = { src: string; width: number; height: number; alt: string; title: string; body: string };

const SHOWCASE: Shot[] = [
  {
    src: "/product/add-machine.webp",
    width: 1012,
    height: 486,
    alt: "Add a machine screen with Bearing, Gearbox and Other cards; Bearing selected",
    title: "Register a machine",
    body: "Choose the machine type, then give it a name and location.",
  },
  {
    src: "/product/setup.webp",
    width: 1164,
    height: 433,
    alt: "Setup panel showing 4 of 10 baseline recordings, with a minimum of 10 and 30 recommended",
    title: "Build its normal sound",
    body: "Upload normal recordings in one batch and watch the baseline fill.",
  },
  {
    src: "/product/attention.webp",
    width: 1164,
    height: 403,
    alt: "Needs attention list with two machines showing repeated unusual readings and one with an incomplete baseline",
    title: "See what needs attention",
    body: "Alerts first, then machines that need baselines or a first check.",
  },
  {
    src: "/product/windows.webp",
    width: 1164,
    height: 359,
    alt: "Bar chart of six 10-second window scores against a dashed threshold line",
    title: "Read the result",
    body: "A plain verdict, then each 10-second window against the threshold.",
  },
  {
    src: "/product/listen-compare.webp",
    width: 1164,
    height: 952,
    alt: "Listen and compare panel with two synced waveforms and a frequency profile with the largest difference shaded around 732 Hz",
    title: "Listen & compare",
    body: "Hear the check next to a normal reference and see where the sound differs.",
  },
];

export default function Landing() {
  return (
    <div className="landing theme-dark">
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
            <a href="#capabilities">Capabilities</a>
            <a href="#evidence">Evidence</a>
            <Link href="/guide">User guide</Link>
          </nav>
          <div className="l-nav-cta">
            <SessionCta variant="nav" />
          </div>
          <details className="l-mobile-nav">
            <summary aria-label="Open the section menu">Menu</summary>
            <nav aria-label="Sections (mobile)">
              <a href="#how">How it works</a>
              <a href="#capabilities">Capabilities</a>
              <a href="#product">The product</a>
              <a href="#evidence">Evidence</a>
              <Link href="/guide">User guide</Link>
            </nav>
          </details>
        </div>
      </header>

      <main id="main">
        {/* 1. Hero */}
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-glow" aria-hidden="true" />
          <div className="hero-grid-bg" aria-hidden="true" />
          <div className="hero-grid-spot" aria-hidden="true" />
          <span className="hero-cell" aria-hidden="true" />
          <div className="l-container hero-layout">
            <div className="hero-copy">
              <p className="pill">
                <span className="pill-dot" aria-hidden="true" />
                Acoustic machine monitoring · research prototype
              </p>
              <h1 id="hero-title">
                Every machine has a sound. <em>Know when it changes.</em>
              </h1>
              <p className="lead">
                Sonovate helps industrial teams monitor acoustic changes in their machines by comparing new recordings
                against machine-specific normal sound baselines.
              </p>
              <div className="hero-cta">
                <SessionCta variant="hero" />
                <a href="#how" className="btn btn-ghost btn-lg">
                  Explore how it works
                </a>
              </div>
              <dl className="hero-facts">
                <div>
                  <dt>Baseline</dt>
                  <dd className="num">10–30 clips</dd>
                </div>
                <div>
                  <dt>Check</dt>
                  <dd className="num">10–60 s</dd>
                </div>
                <div>
                  <dt>Input</dt>
                  <dd>Phone or video</dd>
                </div>
              </dl>
            </div>
            <figure className="instrument tilt shot-hero">
              <Image
                src="/product/result-hero.webp"
                width={1154}
                height={508}
                priority
                sizes="(min-width: 1000px) 56vw, 92vw"
                alt="Sonovate result page: Unusual compared with this machine's normal sound, the threshold position, and Listen and compare below"
              />
              <figcaption className="instrument-caption">
                The real result page, shown with demo recordings from the public MIMII DG dataset.
              </figcaption>
            </figure>
          </div>
          <a href="#problem" className="scroll-cue" aria-label="Scroll to the problem Sonovate addresses">
            <span />
          </a>
        </section>

        {/* 2. The problem */}
        <section id="problem" className="l-section" aria-labelledby="problem-title">
          <div className="l-container problem-layout">
            <div className="l-section-head" data-reveal>
              <p className="eyebrow">The problem</p>
              <h2 id="problem-title">
                Machines change their sound <em>before anyone notices.</em>
              </h2>
              <div className="problem-visual" aria-hidden="true">
                <SignalBars count={72} seed={1.3} />
                <SignalTrace className="problem-trace" />
                <span className="problem-visual-label">Illustration</span>
              </div>
            </div>
            <ol className="problem-list">
              {PROBLEM.map((p, i) => (
                <li key={p.title} className="spot" data-reveal style={delay(i * 110)}>
                  <span className="problem-n num" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3>{p.title}</h3>
                    <p>{p.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 3. How it works */}
        <section id="how" className="l-section l-section-alt" aria-labelledby="how-title">
          <div className="l-container">
            <div className="l-section-head" data-reveal>
              <p className="eyebrow">How it works</p>
              <h2 id="how-title">
                Three steps from first recording to <em>first comparison.</em>
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
                      {s.icon}
                      <span className="step-n num">Step {s.n}</span>
                    </div>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                    <ul className="step-points">
                      {s.points.map((pt) => (
                        <li key={pt}>{pt}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* 4. Capabilities */}
        <section id="capabilities" className="l-section" aria-labelledby="cap-title">
          <div className="l-container">
            <div className="l-section-head l-section-head-wide" data-reveal>
              <p className="eyebrow">Capabilities</p>
              <h2 id="cap-title">
                Built for repeatable, <em>inspectable</em> monitoring.
              </h2>
              <p className="l-body">Everything here works in the app today.</p>
            </div>
            <ul className="usp-grid">
              {USPS.map((u, i) => (
                <li key={u.title} className="usp spot" data-reveal style={delay((i % 3) * 100)}>
                  <span className="usp-n num" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3>{u.title}</h3>
                  <p>{u.body}</p>
                  {u.tag && <span className="tag usp-tag">{u.tag}</span>}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 5. The product */}
        <section id="product" className="l-section l-section-alt" aria-labelledby="product-title">
          <div className="l-container">
            <div className="l-section-head l-section-head-wide" data-reveal>
              <p className="eyebrow">The product</p>
              <h2 id="product-title">
                From recording to <em>understanding.</em>
              </h2>
              <p className="l-body">Screens from the working app, shown with demo recordings from the public MIMII DG dataset.</p>
            </div>
            <ol className="showcase">
              {SHOWCASE.map((s, i) => (
                <li key={s.src} className={`showcase-item${i === SHOWCASE.length - 1 ? " is-wide" : ""}`} data-reveal style={delay((i % 2) * 120)}>
                  <figure className="shot-frame">
                    <Image src={s.src} width={s.width} height={s.height} alt={s.alt} sizes="(min-width: 1000px) 560px, 92vw" />
                  </figure>
                  <div className="showcase-copy">
                    <span className="num showcase-n">{String(i + 1).padStart(2, "0")}</span>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <ModelStory />

        {/* 6. Evidence and honesty */}
        <section id="evidence" className="l-section" aria-labelledby="evidence-title">
          <div className="l-container">
            <div className="l-section-head l-section-head-wide" data-reveal>
              <p className="eyebrow">Built on evidence, designed with honesty</p>
              <h2 id="evidence-title">
                Technology you can inspect. <em>Results you can question.</em>
              </h2>
              <p className="l-body">
                Sonovate shows what each result is based on and says plainly what it cannot tell you. Each model change
                was checked on held-out lab recordings before it was adopted, and every decision is written down.
              </p>
            </div>
            <ul className="honesty-grid">
              {HONESTY.map((h, i) => (
                <li key={h.title} className="spot" data-reveal style={delay((i % 3) * 100)}>
                  <h3>{h.title}</h3>
                  <p>{h.body}</p>
                </li>
              ))}
            </ul>
            <p className="evidence-link" data-reveal>
              <Link href="/guide#evidence" className="btn btn-ghost">
                See the evidence and limits
              </Link>
              <span className="l-footnote">
                Operating conditions such as speed or load are stored with recordings for your records; the current
                model listens to audio only.
              </span>
            </p>
          </div>
        </section>

        {/* 7. Final call to action */}
        <section className="l-cta" aria-labelledby="cta-title">
          <div className="l-container l-cta-inner" data-reveal>
            <SignalTrace className="l-cta-trace" />
            <h2 id="cta-title">Start listening to your machines differently.</h2>
            <p className="l-body">Create your first machine profile and establish its normal acoustic baseline.</p>
            <div className="hero-cta">
              <SessionCta variant="pair" />
              <Link href="/guide" className="btn btn-ghost btn-lg">
                Read the user guide
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="l-footer">
        <div className="l-container l-footer-inner">
          <Brand href="/" />
          <nav aria-label="Footer" className="l-footer-links">
            <a href="#how">How it works</a>
            <a href="#capabilities">Capabilities</a>
            <a href="#evidence">Evidence</a>
            <Link href="/guide">User guide</Link>
            <Link href="/login">Sign in</Link>
          </nav>
          <p>Research prototype. Acoustic anomaly screening; not a diagnosis or failure prediction.</p>
        </div>
      </footer>
    </div>
  );
}
