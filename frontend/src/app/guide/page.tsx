"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
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

function Mock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="guide-mock" aria-label={label}>
      <figcaption>{label}</figcaption>
      {children}
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
      <header className="guide-hero theme-dark">
        <div className="dash-hero-glow" aria-hidden="true" />
        <p className="eyebrow">User guide</p>
        <h1>
          How to use <em>Sonovate</em>
        </h1>
        <p className="guide-lead">
          From your first machine to reading a result, step by step. Each step uses the same labels you will see on
          screen.
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
              Sonovate learns how <strong>each of your machines</strong> sounds when it runs normally, then tells you
              whether a new recording sits <strong>above or below that machine&apos;s own baseline threshold</strong>.
              It is a screening aid: a quick, repeatable way to notice when a machine starts to sound different.
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
            <Mock label="Machine type cards">
              <div className="mock-select">
                <div className="mock-option">
                  <strong>Bearing</strong>
                  <span>Analysed. Optional input: rotation speed.</span>
                </div>
                <div className="mock-option">
                  <strong>Gearbox</strong>
                  <span>Analysed. Optional inputs: motor voltage and load weight.</span>
                </div>
                <div className="mock-option">
                  <strong>Other</strong>
                  <span>Stored only. Recordings can be kept but not analysed.</span>
                </div>
              </div>
            </Mock>
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
            <Mock label="Baseline progress">
              <div className="mock-meter">
                {Array.from({ length: BASELINE_REQUIRED }, (_, i) => (
                  <span key={i} className={i < 7 ? "is-on" : undefined} />
                ))}
              </div>
              <p className="mock-caption">
                Baseline needed before analysis <span className="num">7/{BASELINE_REQUIRED}</span>
              </p>
            </Mock>
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
            <p>Every result says one of two things, always next to the research-prototype notice:</p>
            <div className="guide-cards guide-cards-2">
              <div className="is-above">
                <strong>Above this machine&apos;s baseline threshold</strong>
                <span>
                  The clip is less typical than the baseline. Worth a closer look; it is not a confirmed fault.
                </span>
              </div>
              <div>
                <strong>Below this machine&apos;s baseline threshold</strong>
                <span>
                  The clip is similar to the baseline. That does not prove the machine is healthy: most faults are
                  missed.
                </span>
              </div>
            </div>
            <Mock label="Score strip">
              <div className="mock-strip">
                <span className="mock-zone" />
                <span className="mock-threshold" />
                <span className="mock-marker" />
                <span className="mock-side mock-below">below</span>
                <span className="mock-side mock-above">above</span>
              </div>
              <p className="mock-caption">
                The dot is the recording&apos;s score; the line is the machine&apos;s threshold; the hatched area is
                &ldquo;above&rdquo;.
              </p>
            </Mock>
            <p className="muted small">
              The score is a distance in the model&apos;s embedding space, shown on a log scale. It is not a percentage
              or a chance of failure. Each result records the model version that produced it.
            </p>
            <h3>Listen &amp; compare</h3>
            <p>
              Below every analysed recording, <Ui>Listen &amp; compare</Ui> plays it in sync with one of the
              machine&apos;s baseline recordings, so you can hear what changed instead of trusting a number.
            </p>
            <ol className="guide-steps">
              <li>
                Choose a baseline under <Ui>Compare with</Ui>. Baselines recorded at the same setting are listed first
                and marked <Ui>same setting</Ui>.
              </li>
              <li>
                Press play, then switch between <Ui>A · This recording</Ui> and <Ui>B · Baseline</Ui>. The switch is
                instant and keeps your place, so a short difference is easy to catch. Click a waveform to jump.
              </li>
              <li>
                Keep <Ui>Match loudness</Ui> on so a louder clip does not simply sound &ldquo;worse&rdquo;.
              </li>
              <li>
                The <Ui>Average frequency profile</Ui> shows where the energy differs, for example a hum around
                500 Hz. It is measured from the two files, not used by the model, and not a diagnosis.
              </li>
            </ol>
          </Section>

          <Section id="alerts" title="5. Alerts and history">
            <ul className="guide-list">
              <li>
                <strong>Machine alert</strong>: shown when at least 2 of the last 3 analyses are above the threshold.
                The rule was chosen on simulated timelines, not real machine histories.
              </li>
              <li>
                <strong>Dashboard</strong>: the summary tiles, <Ui>Next steps</Ui> and <Ui>Recent analyses</Ui> show
                what needs attention across all machines. Use the filters above <Ui>Your machines</Ui> to show only
                alerts, machines that need a baseline, and so on.
              </li>
              <li>
                <strong>History</strong>: open a machine and choose <Ui>View history</Ui> to see every recording, its
                conditions and its result over time. The machine page also shows a <Ui>Result timeline</Ui> (one dot
                per analysis; the latest 3 decide the alert), <Ui>Operating-condition coverage</Ui> (whether your
                baselines were recorded at the same settings as your analyses), and <Ui>Export CSV</Ui> for your own
                records.
              </li>
            </ul>
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

export default function GuidePage() {
  return (
    <AppShell>
      <GuideView />
    </AppShell>
  );
}
