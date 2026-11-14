"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { Brand } from "@/components/Brand";
import { Loading } from "@/components/Status";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { BASELINE_REQUIRED } from "@/lib/api";
import { MODEL_INPUTS } from "@/lib/modelInputs";

// In-app user manual. Every label quoted here matches the app's own screens;
// keep them in sync when those screens change.

const SECTIONS = [
  { id: "overview", title: "What Sonovate does" },
  { id: "before", title: "Before you start" },
  { id: "add-machine", title: "1. Add a machine" },
  { id: "baseline", title: "2. Record a baseline" },
  { id: "analyse", title: "3. Run a machine check" },
  { id: "results", title: "4. Read the result" },
  { id: "alerts", title: "5. Alerts and history" },
  { id: "evidence", title: "What it can and cannot tell you" },
  { id: "manage", title: "6. Edit and delete" },
  { id: "troubleshooting", title: "Troubleshooting" },
  { id: "demo", title: "Presenting with the demo" },
];

const QUICK = [
  { n: "1", title: "Add a machine", href: "#add-machine" },
  { n: "2", title: `Upload ${BASELINE_REQUIRED} baselines`, href: "#baseline" },
  { n: "3", title: "Run a check", href: "#analyse" },
  { n: "4", title: "Listen & compare", href: "#results" },
  { n: "5", title: "Read & track", href: "#results" },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="guide-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {children}
    </section>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="guide-steps">{children}</ol>;
}

function Ui({ children }: { children: ReactNode }) {
  return <span className="ui-label">{children}</span>;
}

function Tip({ title = "Tip", children }: { title?: string; children: ReactNode }) {
  return (
    <aside className="guide-tip">
      <strong>{title}</strong>
      <div>{children}</div>
    </aside>
  );
}

// A real screenshot of the app (public/product/, captured with the demo
// account's public MIMII DG recordings; no account details shown).
function Shot({ src, width, height, alt, caption }: { src: string; width: number; height: number; alt: string; caption: string }) {
  return (
    <figure className="guide-shot">
      <Image src={src} width={width} height={height} alt={alt} sizes="(min-width: 1000px) 720px, 92vw" />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function GuideView() {
  const [active, setActive] = useState(SECTIONS[0].id);

  // Highlight the section being read in the contents list.
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => e !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -60% 0px" },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="guide">
      <header className="guide-hero">
        <div className="dash-hero-glow" aria-hidden="true" />
        <p className="eyebrow">User guide</p>
        <h1>
          How to use <em>Sonovate</em>
        </h1>
        <p className="guide-lead">
          Register a machine, record its normal sound, then check new recordings against it. Each step below uses the
          labels you see on screen.
        </p>
        <p className="guide-start">
          <Link href="/machines/new" className="btn btn-primary btn-sm">
            Add a machine
          </Link>
          <Link href="/machines" className="btn btn-ghost btn-sm">
            Open your machines
          </Link>
        </p>
        <ol className="guide-quick">
          {QUICK.map((q) => (
            <li key={q.n}>
              <a href={q.href}>
                <span className="num">{q.n}</span>
                {q.title}
              </a>
            </li>
          ))}
        </ol>
      </header>

      <div className="guide-layout">
        <nav className="guide-toc" aria-label="Guide contents">
          <p className="eyebrow">Contents</p>
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} aria-current={active === s.id ? "true" : undefined}>
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="guide-body">
          <Section id="overview" title="What Sonovate does">
            <p>
              Sonovate learns how <strong>each of your machines</strong> sounds when it runs normally. Each new
              recording is then placed <strong>above or below that machine&apos;s own threshold</strong>: a quick,
              repeatable way to notice when a machine starts to sound different.
            </p>
            <div className="guide-cards">
              <div>
                <strong>Per-machine baseline</strong>
                <span>Each machine is compared only with its own normal sound, never with a generic average.</span>
              </div>
              <div>
                <strong>A history you can follow</strong>
                <span>Every recording, its operating conditions and its result are kept on a timeline.</span>
              </div>
              <div>
                <strong>Alerts worth checking</strong>
                <span>Repeated results above the threshold raise a machine alert, so one odd clip is not enough.</span>
              </div>
            </div>
            <Tip title="What it is not">
              Not a diagnosis, not a failure probability and not a remaining-life estimate. It is a research prototype
              with low sensitivity: it misses most faults at a low false-alarm rate, and it can flag normal recordings.
              No alert does not mean no fault. Use it alongside your normal inspections.
            </Tip>
          </Section>

          <Section id="before" title="Before you start">
            <p>You need a phone or recorder and the machine you want to watch. A recording can be:</p>
            <ul className="guide-specs">
              <li>
                <span className="num">Audio or video</span>: WAV, MP3, M4A, or an MP4/MOV video with sound
              </li>
              <li>
                <span className="num">10 to 60 s</span> long; <strong>60 s is recommended</strong> for checks
              </li>
              <li>
                <span className="num">Converted for you</span>: the browser turns it into 16 kHz mono and uploads only
                that audio (the first 60 s)
              </li>
              <li>
                <span className="num">≤ 2 MiB</span> after conversion (60 s of 16 kHz mono is about 1.9 MiB)
              </li>
            </ul>
            <p>
              A 16 kHz mono WAV is uploaded as it is. To convert by hand instead, the free <code>ffmpeg</code> tool
              does it:
            </p>
            <pre className="guide-code">
              <code>ffmpeg -i input.mp4 -vn -ac 1 -ar 16000 -t 60 output.wav</code>
            </pre>
            <Tip title="Recording tips">
              Record from the same spot, at the same distance and with the same device every time, so the only thing
              that changes is the machine. Avoid talking or other loud machines nearby. Note the operating settings
              (speed, voltage, load) if you know them.
            </Tip>
          </Section>

          <Section id="add-machine" title="1. Add a machine">
            <Steps>
              <li>
                Open <Link href="/machines">Machines</Link> and press <Ui>+ Add machine</Ui>.
              </li>
              <li>
                Choose the machine type card (see below) and press <Ui>Continue</Ui>. Nothing is selected until you
                choose.
              </li>
              <li>
                Enter a <Ui>Machine name</Ui> you will recognise, for example &ldquo;Main Water Pump&rdquo;, and
                optionally a <Ui>Location</Ui> and <Ui>Notes</Ui>.
              </li>
              <li>
                Press <Ui>Create machine</Ui>. The new machine&apos;s page opens, ready for its baseline recordings.
              </li>
            </Steps>
            <Shot
              src="/product/add-machine.webp"
              width={1012}
              height={486}
              alt="The machine type step with Bearing, Gearbox and Other cards; Bearing is selected"
              caption="Step 1 of adding a machine: choose its type."
            />
            <ul className="guide-list">
              <li>
                <strong>Bearing</strong> and <strong>Gearbox</strong>: analysed. Optional operating inputs: rotation
                speed (bearing); motor voltage and load weight (gearbox).
              </li>
              <li>
                <strong>Other</strong>: stored only. Recordings can be kept but not analysed.
              </li>
            </ul>
            <p className="muted small">
              The model was validated only on lab bearings and gearboxes, which is why other machine types are not
              analysed.
            </p>
          </Section>

          <Section id="baseline" title="2. Record a baseline">
            <p>
              The baseline teaches Sonovate what <strong>normal</strong> sounds like for this machine. Record it while
              you know the machine is running well.
            </p>
            <Steps>
              <li>
                Open the machine and choose <Ui>Add baseline recordings</Ui> (it opens there until the baseline is
                complete).
              </li>
              <li>
                Drag your recordings onto the upload area, or press <Ui>Choose files</Ui> and select several at once.
                You can remove a file from the list before uploading.
              </li>
              <li>
                Optionally open <Ui>Advanced details</Ui> to store operating conditions or the recording time (below).
                They apply to every file in that batch.
              </li>
              <li>
                Press <Ui>Upload</Ui>. Files upload one after another, each with its own status. If one fails, the
                others are kept; press <Ui>Retry</Ui> to send only the failed ones again.
              </li>
              <li>
                Checks are available once the machine has <span className="num">{BASELINE_REQUIRED}</span> baseline
                recordings. About <span className="num">30</span> give the baseline wider coverage of normal operation
                (not a guarantee of better fault detection); only the first 10 s of each baseline recording is used.
              </li>
            </Steps>
            <Shot
              src="/product/setup.webp"
              width={1164}
              height={433}
              alt="Setup panel: 4 normal recordings uploaded, minimum 10 with 6 to go, 30 recommended"
              caption="Baseline progress while a machine is being set up."
            />
            <h3>Operating conditions</h3>
            <p>
              These optional fields, under <Ui>Advanced details</Ui>, depend on the machine type. They are stored for
              your records and comparisons and are not used by the acoustic model, so leaving them blank does not
              change any result.
            </p>
            <div className="guide-table" role="table" aria-label="Operating conditions by machine type">
              <div role="row" className="guide-table-head">
                <span role="columnheader">Machine type</span>
                <span role="columnheader">Field</span>
                <span role="columnheader">Range in the test data</span>
              </div>
              {(["bearing", "gearbox"] as const).flatMap((type) =>
                MODEL_INPUTS[type].map((input) => (
                  <div role="row" key={`${type}-${input.name}`}>
                    <span role="cell">{type === "bearing" ? "Bearing" : "Gearbox"}</span>
                    <span role="cell">
                      {input.label} ({input.unit})
                    </span>
                    <span role="cell" className="num">
                      {input.min}–{input.max} {input.unit}
                    </span>
                  </div>
                )),
              )}
            </div>
            <p className="muted small">
              A value outside this range is accepted, with a notice that it falls outside the conditions represented
              in the test data. You can also add <Ui>Other readings</Ui> with any name, value and unit.
            </p>
            <Tip>Adding or removing a baseline recording changes the threshold used for the next analysis.</Tip>
          </Section>

          <Section id="analyse" title="3. Run a machine check">
            <Steps>
              <li>
                On the machine&apos;s page, choose <Ui>Run a machine check</Ui> and pick one recording (60 s is best).
                You can listen to it before uploading.
              </li>
              <li>
                Press <Ui>Upload and run check</Ui>. The steps are shown as they happen: preparing audio, uploading,
                comparing against the machine&apos;s baseline and generating the result.
              </li>
              <li>
                The result page opens. Each 10 s window is compared with the baseline; a 30–60 s recording is judged on
                the average of its windows, which catches noticeably more problems than one 10 s clip.
              </li>
              <li>
                <Ui>Re-run analysis</Ui> on the result page asks for confirmation, because it adds another result for
                the same recording.
              </li>
            </Steps>
            <Tip title="Good to know">
              Baseline recordings are never analysed: they define normal. A clip identical to one of the baselines is
              refused.
            </Tip>
          </Section>

          <Section id="results" title="4. Read the result">
            <p>
              The result page opens with one of two verdicts, then <Ui>Listen &amp; compare</Ui>, a recording overview,
              a bar per 10-second window and what to do next. The exact scores sit under <Ui>Technical details</Ui>.
            </p>
            <div className="guide-cards guide-cards-2">
              <div className="is-above">
                <strong>Unusual compared with this machine&apos;s normal sound</strong>
                <span>
                  Above this machine&apos;s baseline threshold. Worth inspecting; it does not confirm a fault.
                </span>
              </div>
              <div>
                <strong>Similar to this machine&apos;s normal sound</strong>
                <span>
                  Below this machine&apos;s baseline threshold. That does not guarantee the machine is fault-free: most
                  faults are missed.
                </span>
              </div>
            </div>
            <Shot
              src="/product/verdict.webp"
              width={1164}
              height={313}
              alt="Result verdict: Unusual compared with this machine's normal sound, with the threshold position bar"
              caption="The verdict and the dot's position against this machine's threshold."
            />
            <Shot
              src="/product/windows.webp"
              width={1164}
              height={359}
              alt="Six bars, one per 10-second window, against a dashed threshold line"
              caption="A 60-second check: one bar per 10-second window. The verdict uses their average."
            />
            <p className="muted small">
              The score is a distance in the model&apos;s embedding space, shown on a log scale. It is not a percentage
              or a chance of failure. The window bars show each 10-second part against the same threshold line; the
              verdict uses their average, and a tall bar does not show where a fault is. Each result records the model
              version that produced it.
            </p>
            <h3>Listen &amp; compare</h3>
            <p>
              Right below the verdict, <Ui>Listen &amp; compare</Ui> plays the check in sync with one of the
              machine&apos;s normal references, so you can hear what changed instead of trusting a number.
            </p>
            <ol className="guide-steps">
              <li>
                Choose one under <Ui>Normal reference</Ui>. References recorded at the same setting are listed first
                and marked <Ui>same setting</Ui>.
              </li>
              <li>
                Press play, then switch between <Ui>This check</Ui> and <Ui>Normal reference</Ui>. The switch is
                instant and keeps your place, so a short difference is easy to catch. Click a waveform to jump.
              </li>
              <li>
                Keep <Ui>Match loudness</Ui> on so a louder clip does not simply sound &ldquo;worse&rdquo;.
              </li>
              <li>
                The <Ui>Average frequency profile</Ui> shows where the energy differs, for example a hum around
                500 Hz; the band named in the summary is shaded. It is a descriptive comparison measured from the two
                files, not used by the model, and not a diagnosis. Loudness figures are under <Ui>Loudness details</Ui>.
              </li>
            </ol>
            <Shot
              src="/product/listen-compare.webp"
              width={1164}
              height={952}
              alt="Listen and compare with two synced waveforms and a frequency profile; the largest difference is shaded around 732 Hz"
              caption="Listen & compare: this check against a normal reference, with the largest difference shaded."
            />
          </Section>

          <Section id="alerts" title="5. Alerts and history">
            <ul className="guide-list">
              <li>
                <strong>Machine alert</strong> (<Ui>Repeated unusual readings</Ui>): shown when at least 2 of the last
                3 checks are above the threshold. The rule was chosen on simulated timelines, not real machine
                histories. <Ui>No current machine alert</Ui> does not confirm that a machine is fault-free.
              </li>
              <li>
                <strong>Dashboard</strong>: <Ui>Needs attention</Ui> lists machines with an alert first, then those
                that need baselines or a first check, each with its next action. The summary tiles and{" "}
                <Ui>Recent checks</Ui> sit below; use the filters above <Ui>Your machines</Ui> to show only alerts,
                machines that need a baseline, and so on.
              </li>
              <li>
                <strong>History</strong>: open a machine and choose <Ui>History</Ui> for a table of every recording,
                filterable by type and result, sortable by date, with expandable rows. The machine page itself
                splits recordings into <Ui>Baselines</Ui> (with playback and delete) and <Ui>Checks</Ui> (with their
                result), and shows a <Ui>Result timeline</Ui> (one dot
                per analysis; the latest 3 decide the alert), <Ui>Operating-condition coverage</Ui> (whether your
                baselines were recorded at the same settings as your analyses), and <Ui>Export CSV</Ui> for your own
                records.
              </li>
            </ul>
            <Shot
              src="/product/attention.webp"
              width={1164}
              height={403}
              alt="Needs attention list: two machines with repeated unusual readings, one with an incomplete baseline"
              caption="The dashboard's Needs attention list, with each machine's next action."
            />
          </Section>

          <Section id="evidence" title="What it can and cannot tell you">
            <p>
              Sonovate is a research prototype for <strong>acoustic anomaly screening</strong>. A result says whether a
              recording sounds unlike that machine&apos;s normal recordings. It does not name a fault, a part or a
              cause, and it does not predict when a machine will fail.
            </p>
            <div className="guide-cards guide-cards-2">
              <div className="is-above">
                <strong>Above threshold is not a confirmed fault</strong>
                <span>It is a reason to inspect the machine with your usual procedures. Normal recordings are sometimes flagged.</span>
              </div>
              <div>
                <strong>Below threshold is not a clean bill of health</strong>
                <span>Many anomalies are missed. No alert does not mean no fault.</span>
              </div>
            </div>
            <h3>How it was tested</h3>
            <p>
              The model (<code>sonovate-ast-head</code> 0.4.0) was developed on lab recordings of bearings and gearboxes
              with deliberately induced faults (MIMII DG). Each setting was chosen on development data and then
              checked on held-out recordings it had not been tuned on (DCASE 2022 Task 2 and MIMII DUE). Every
              experiment and decision is recorded in the project&apos;s experiment log and decision record.
            </p>
            <div className="guide-table guide-table-evidence" role="table" aria-label="Held-out results with 10 normal recordings, Standard sensitivity">
              <div role="row" className="guide-table-head">
                <span role="columnheader">Check</span>
                <span role="columnheader">Anomalous recordings flagged</span>
                <span role="columnheader">Normal recordings flagged</span>
                <span role="columnheader">Test data</span>
              </div>
              <div role="row">
                <span role="cell">Gearbox, 60 s</span>
                <span role="cell" className="num">about 42%</span>
                <span role="cell" className="num">about 9%</span>
                <span role="cell">MIMII DUE evaluation (third use)</span>
              </div>
              <div role="row">
                <span role="cell">Gearbox, 10 s</span>
                <span role="cell" className="num">about 25%</span>
                <span role="cell" className="num">about 9%</span>
                <span role="cell">MIMII DUE evaluation (third use)</span>
              </div>
              <div role="row">
                <span role="cell">Bearing, 60 s</span>
                <span role="cell" className="num">about 43%</span>
                <span role="cell" className="num">about 9%</span>
                <span role="cell">DCASE 2022 bearing (reused many times; weak evidence)</span>
              </div>
              <div role="row">
                <span role="cell">Bearing, 10 s</span>
                <span role="cell" className="num">about 18%</span>
                <span role="cell" className="num">about 9%</span>
                <span role="cell">DCASE 2022 bearing (reused many times; weak evidence)</span>
              </div>
            </div>
            <p className="muted small">
              Sources: EXP-026 (gearbox) and EXP-029 (bearing) in <code>docs/EXPERIMENT_LOG.md</code>; 10 normal
              recordings per machine, Standard sensitivity. With <strong>High sensitivity</strong> (ADR-014, EXP-032)
              more anomalies are flagged (for 60 s gearbox checks about 57%) but so are more normal recordings (about
              17%).
            </p>
            <p className="muted small">
              <strong>With 20 or more normal recordings</strong> the Standard threshold is tuned for that baseline size
              (ADR-015, EXP-033), so normal recordings are still flagged about 9% of the time while more anomalies are
              caught. With 30: 60 s checks about 57% (gearbox) and 72% (bearing, weak evidence), 10 s checks about 31%
              for both. This is why 30 normal recordings are recommended.
            </p>
            <Tip title="Read these figures with care">
              <ul className="guide-list">
                <li>They come from lab recordings, not from your machines, microphones or rooms; results in real use can be lower.</li>
                <li>The 30 s and 60 s figures were measured on recordings joined from separate 10 s clips, which may make them look better than continuous recordings.</li>
                <li>The test sets had been used before, so they are supporting evidence rather than a clean first test; the bearing evidence is weak.</li>
                <li>There are no figures for other machine types, which is why only bearings and gearboxes are analysed.</li>
                <li>Operating conditions you enter are stored for your records; the model listens to audio only.</li>
              </ul>
            </Tip>
          </Section>

          <Section id="manage" title="6. Edit and delete">
            <ul className="guide-list">
              <li>
                <Ui>Edit</Ui> on a machine&apos;s details changes its name, type, location or notes.
              </li>
              <li>
                <Ui>Delete recording</Ui> removes the audio file and its result. <Ui>Delete machine</Ui> removes the
                machine with all its recordings. Both ask you to confirm.
              </li>
              <li>
                <Link href="/account">Account</Link> lets you delete your account and all of your data.
              </li>
            </ul>
            <p className="muted small">Your machines, recordings and results are visible only to you.</p>
          </Section>

          <Section id="troubleshooting" title="Troubleshooting">
            <dl className="guide-faq">
              <div>
                <dt>&ldquo;Sample rate must be 16 kHz&rdquo; or a duration error</dt>
                <dd>
                  The recording must be 10 to 60 s long after conversion. If the browser cannot read the file, convert
                  it with the ffmpeg command above.
                </dd>
              </div>
              <div>
                <dt>&ldquo;File is larger than 2 MiB&rdquo;</dt>
                <dd>
                  A WAV that is not 16 kHz mono is converted in the browser; a 16 kHz mono WAV must be 60 s or shorter
                  (about 1.9 MiB).
                </dd>
              </div>
              <div>
                <dt>Analysis says a baseline is required</dt>
                <dd>
                  The machine has fewer than {BASELINE_REQUIRED} baseline recordings. Upload more under Add baseline
                  recordings.
                </dd>
              </div>
              <div>
                <dt>&ldquo;Analysis is not available for this machine type&rdquo;</dt>
                <dd>The machine type is Other. Only bearings and gearboxes are analysed.</dd>
              </div>
              <div>
                <dt>&ldquo;Analysis service unreachable&rdquo; on the dashboard</dt>
                <dd>The analysis service is not running or cannot be reached. Uploads still work; analysis will not.</dd>
              </div>
            </dl>
          </Section>

          <Section id="demo" title="Presenting with the demo">
            <p>
              A local demo account can be filled with real recordings from the public MIMII DG dataset (CC BY 4.0), so
              you can show the whole flow without recording anything yourself.
            </p>
            <Steps>
              <li>
                Make sure the local stack and the analysis service are running, then from <code>frontend/</code> run{" "}
                <code>npm run seed:demo</code> (add <code>-- --reset</code> to start over).
              </li>
              <li>
                Sign in as <code>demo@sonovate.test</code> (local only; the password is in{" "}
                <code>frontend/README.md</code>).
              </li>
              <li>Walk through the three demo machines:</li>
            </Steps>
            <div className="guide-cards">
              <div>
                <strong>Gearbox, line 2</strong>
                <span>Complete baseline and five analysed clips: two normal, then three anomaly. Good for showing the alert rule.</span>
              </div>
              <div>
                <strong>Pump bearing</strong>
                <span>Complete baseline and four analysed clips, normal and anomaly mixed.</span>
              </div>
              <div>
                <strong>Conveyor bearing (new)</strong>
                <span>Only 4 of {BASELINE_REQUIRED} baseline clips: shows the &ldquo;needs baseline&rdquo; state.</span>
              </div>
            </div>
            <Tip title="Be honest about the demo">
              Every result is the real model output for that clip. Each clip&apos;s file name says whether the dataset
              labels it normal or anomaly, so you can show both hits and misses, including normal clips flagged above
              the threshold. Demo results are not an evaluation of the model.
            </Tip>
          </Section>
        </div>
      </div>
    </div>
  );
}

// The guide holds no user data, so it is readable without an account:
// signed-in users get the app shell, visitors a slim public header.
function PublicHeader() {
  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <Brand href="/" />
        <nav aria-label="Main" className="app-nav">
          <Link href="/">Home</Link>
          <Link href="/guide" aria-current="page">
            Guide
          </Link>
        </nav>
        <div className="topbar-user">
          <ThemeSwitch compact />
          <Link href="/login" className="button-like btn-sm">
            Sign in
          </Link>
          <Link href="/login?mode=sign-up" className="btn btn-primary btn-sm">
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function GuidePage() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <main className="container session-check">
        <Loading label="Loading the guide…" />
      </main>
    );
  }
  if (session) {
    return (
      <AppShell>
        <GuideView />
      </AppShell>
    );
  }
  return (
    <>
      <PublicHeader />
      <main className="container">
        <GuideView />
      </main>
    </>
  );
}
