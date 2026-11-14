"use client";

// Building blocks of the signed-in overview (/machines). Everything shown is
// read from the user's own data or the model registry: no invented scores,
// trends or health levels. Positions relative to a threshold are positions,
// not probabilities.

import Link from "next/link";
import type { ReactNode } from "react";
import {
  BASELINE_RECOMMENDED,
  BASELINE_REQUIRED,
  type AlertEpisode,
  type MachineOverview,
  type ModelVersionInfo,
  type RecentAnalysis,
  type ServiceStatus,
} from "@/lib/api";
import { machineTypeLabel } from "@/lib/modelInputs";
import { ATTENTION_ORDER, nextAction, stateSummary, type MonitoringState } from "@/lib/monitoring";
import {
  ABOVE_LABEL,
  ATTENTION_TEXT,
  WITHIN_LABEL,
  accountNextAction,
  activityFeed,
  attentionReason,
  groupBaselineUploads,
  overviewCounts,
  type Activity,
  type AttentionReason,
  type DashMachine,
} from "@/lib/results";
import { machineStatus } from "./MachineCard";
import { EmptyState, HowAlertsWork, PrototypeNotice, SkeletonBlock, StatusBadge, overviewState } from "./MonitoringStatus";
import { formatDateTime } from "./Status";

// --- helpers ------------------------------------------------------------------

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return formatDateTime(iso);
}

function Svg({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const Icons = {
  machine: (
    <Svg>
      <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="2" fill="currentColor" />
      <path d="M10 1.5v2.5M10 16v2.5M1.5 10H4M16 10h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  ),
  baseline: (
    <Svg>
      <path d="M2 10h2M5.5 6.5v7M9 4v12M12.5 7v6M16 9v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </Svg>
  ),
  analysis: (
    <Svg>
      <path d="M2.5 15.5h15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M11 3v10" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.6 2" />
      <circle cx="7" cy="9.5" r="2" fill="currentColor" />
    </Svg>
  ),
  alert: (
    <Svg>
      <path d="M10 2.8 18 16.5H2L10 2.8Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 8v3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="13.8" r="0.9" fill="currentColor" />
    </Svg>
  ),
  arrow: (
    <Svg size={14}>
      <path d="M4 10h11M11 5.5 15.5 10 11 14.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  ),
  plus: (
    <Svg size={14}>
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  ),
};

// --- compact header -----------------------------------------------------------

const SERVICE_LABEL: Record<ServiceStatus | "checking", string> = {
  checking: "Checking analysis service…",
  online: "Analysis service online",
  unreachable: "Analysis service unreachable",
  not_configured: "Analysis service not configured",
};

// No name is derived from the email address: accounts have no display name.
export function DashHeader({ service }: { service: ServiceStatus | "checking" }) {
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  return (
    <header className="dash-head">
      <div className="dash-hero-glow" aria-hidden="true" />
      <div className="dash-hero-grid" aria-hidden="true" />
      <div className="dash-head-copy">
        <p className="eyebrow">Welcome back · {today}</p>
        <h1>Machine monitoring</h1>
      </div>
      <div className="dash-head-side">
        <span className={`chip chip-service is-${service}`} role="status">
          <span className="chip-dot" aria-hidden="true" />
          {SERVICE_LABEL[service]}
        </span>
        <Link href="/machines/new" className="btn btn-primary">
          {Icons.plus} Add machine
        </Link>
      </div>
      <div className="dash-head-note">
        <PrototypeNotice />
      </div>
    </header>
  );
}

// --- attention -------------------------------------------------------------------

type AttentionItem = { m: MachineOverview; state: MonitoringState };

export function attentionItems(machines: MachineOverview[]): AttentionItem[] {
  return machines
    .map((m) => ({ m, state: overviewState(m) }))
    .filter((i) => i.state !== "records_only")
    .sort((a, b) => ATTENTION_ORDER[a.state] - ATTENTION_ORDER[b.state] || a.m.name.localeCompare(b.m.name));
}

// Machines in order of what needs doing: alerts, then setup, then first checks,
// then routine monitoring. Each row links to the relevant section of its page.
export function AttentionPanel({ machines }: { machines: MachineOverview[] }) {
  const items = attentionItems(machines);
  const needing = items.filter((i) => i.state !== "monitoring").length;
  if (items.length === 0) return null;
  return (
    <section className="card attention" aria-labelledby="attention-title">
      <div className="card-header">
        <div>
          <h2 id="attention-title">Needs attention</h2>
          <p className="muted small">
            {needing === 0
              ? "Nothing waiting. Machines below are being monitored; no alert does not confirm they are fault-free."
              : `${needing} machine${needing === 1 ? "" : "s"} with something to do.`}
          </p>
        </div>
        <HowAlertsWork compact />
      </div>
      <ul className="attention-list">
        {items.map(({ m, state }) => {
          const action = nextAction(state);
          const lastCheck = m.recent[m.recent.length - 1];
          return (
            <li key={m.id} className={`attention-row is-${state}`}>
              <div className="attention-main">
                <Link href={`/machines/${m.id}`} className="attention-name">
                  {m.name}
                </Link>
                <span className="muted small">{machineTypeLabel(m.machine_type)}</span>
              </div>
              <StatusBadge state={state} />
              <span className="attention-last small muted">
                {lastCheck ? `Last check ${relativeTime(lastCheck.created_at)}` : "No checks yet"}
              </span>
              <span className="attention-detail small">{stateSummary(state, m.baselineCount)}</span>
              <Link
                href={`/machines/${m.id}#${action.anchor}`}
                className={`btn btn-sm ${state === "monitoring" ? "btn-outline" : "btn-primary"}`}
                aria-label={`${action.label}: ${m.name}`}
              >
                {action.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// --- KPI tiles ----------------------------------------------------------------

export function KpiTiles({
  machines,
  analyses,
}: {
  machines: MachineOverview[];
  analyses: { total: number; latest: string | null } | null;
}) {
  const analysable = machines.filter((m) => machineStatus(m) !== "unsupported");
  const ready = analysable.filter((m) => m.baselineCount >= BASELINE_REQUIRED).length;
  const alerts = machines.filter((m) => m.alert?.alert).length;
  const bearings = machines.filter((m) => m.machine_type === "bearing").length;
  const gearboxes = machines.filter((m) => m.machine_type === "gearbox").length;

  const tiles: { label: string; value: ReactNode; note: string; icon: ReactNode; warn?: boolean }[] = [
    {
      label: "Machines",
      value: machines.length,
      note: `${bearings} bearing${bearings === 1 ? "" : "s"} · ${gearboxes} gearbox${gearboxes === 1 ? "" : "es"}`,
      icon: Icons.machine,
    },
    {
      label: "Baseline ready",
      value: (
        <>
          {ready}
          <small>/{analysable.length}</small>
        </>
      ),
      note: `At least ${BASELINE_REQUIRED} normal recordings`,
      icon: Icons.baseline,
    },
    {
      label: "Analyses completed",
      value: analyses ? analyses.total : "—",
      note: analyses?.latest ? `Latest ${relativeTime(analyses.latest)}` : "No analyses yet",
      icon: Icons.analysis,
    },
    {
      label: "Machine alerts",
      value: alerts,
      note: "Repeated unusual readings",
      icon: Icons.alert,
      warn: alerts > 0,
    },
  ];

  return (
    <ul className="kpis kpis-compact" aria-label="Summary">
      {tiles.map((t) => (
        <li key={t.label} className={`kpi${t.warn ? " is-warn" : ""}`}>
          <span className="kpi-icon">{t.icon}</span>
          <span className="kpi-label">{t.label}</span>
          <span className="kpi-value num">{t.value}</span>
          <span className="kpi-note">{t.note}</span>
        </li>
      ))}
    </ul>
  );
}

// --- machine filters ------------------------------------------------------------

export type MachineFilter = "all" | "alert" | "needs_baseline" | "ready" | "has_result" | "records_only";

const FILTERS: { id: MachineFilter; label: string }[] = [
  { id: "all", label: "All machines" },
  { id: "alert", label: "Alerts" },
  { id: "needs_baseline", label: "Needs baseline" },
  { id: "ready", label: "Ready for first check" },
  { id: "has_result", label: "With results" },
  { id: "records_only", label: "Records only" },
];

export function matchesFilter(m: MachineOverview, f: MachineFilter): boolean {
  const state = overviewState(m);
  switch (f) {
    case "all":
      return true;
    case "alert":
      return state === "alert";
    case "needs_baseline":
      return state === "baseline_incomplete";
    case "ready":
      return state === "ready_first_check";
    case "has_result":
      return m.checksWithResult > 0;
    case "records_only":
      return state === "records_only";
  }
}

export function MachineFilters({
  machines,
  value,
  onChange,
}: {
  machines: MachineOverview[];
  value: MachineFilter;
  onChange: (f: MachineFilter) => void;
}) {
  return (
    <div className="filters" role="group" aria-label="Filter machines">
      {FILTERS.map((f) => {
        const count = machines.filter((m) => matchesFilter(m, f.id)).length;
        if (f.id !== "all" && count === 0) return null;
        return (
          <button key={f.id} type="button" aria-pressed={value === f.id} onClick={() => onChange(f.id)}>
            {f.label} <span className="num">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

// --- side panels -----------------------------------------------------------------

export function RecentAnalysesPanel({
  items,
  error,
}: {
  items: RecentAnalysis[] | null;
  error: string | null;
}) {
  return (
    <section className="panel" aria-labelledby="recent-title">
      <div className="panel-head">
        <h2 id="recent-title">Recent checks</h2>
        <span className="muted small">Latest first</span>
      </div>
      {error && <p className="small panel-empty">{error}</p>}
      {!error && items === null && <SkeletonBlock lines={3} />}
      {items?.length === 0 && (
        <EmptyState title="No checks yet">
          Once a machine has {BASELINE_REQUIRED} baseline recordings, run a check from its page.
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <ul className="feed">
          {items.map((a) => {
            const above = a.decision === "above_threshold";
            return (
              <li key={a.id}>
                <Link href={`/recordings/${a.recording_id}`} className="feed-item">
                  <span className="feed-top">
                    <strong>{a.machine?.name ?? "Machine"}</strong>
                    <span className={`decision-pill${above ? " is-above" : ""}`}>
                      {above ? "Above threshold" : "Within threshold"}
                    </span>
                  </span>
                  <span className="feed-meta">
                    <span title={formatDateTime(a.created_at)}>{relativeTime(a.created_at)}</span>
                    {a.machine && <span>{machineTypeLabel(a.machine.machine_type)}</span>}
                    {a.baseline_count !== null && <span>vs {a.baseline_count} normal recordings</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const PIPELINE = ["10–60 s recording, 16 kHz", "Frozen AST + condition head", "Distance to own baseline", "Per-machine threshold", "2-of-3 alert"];

export function ModelPanel({ model, error }: { model: ModelVersionInfo | null | undefined; error: string | null }) {
  return (
    <section id="dash-model" className="panel panel-model" aria-labelledby="model-title">
      <div className="panel-head">
        <h2 id="model-title">Analysis model</h2>
      </div>
      {error && <p className="small panel-empty">{error}</p>}
      {model === undefined && !error && <SkeletonBlock lines={2} />}
      {model === null && !error && <p className="muted small panel-empty">No model is registered.</p>}
      {model && (
        <>
          <p className="small">
            Compares each check with that machine&apos;s own normal recordings. Bearings and gearboxes;{" "}
            {BASELINE_REQUIRED} normal recordings minimum, {BASELINE_RECOMMENDED} recommended.
          </p>
          <details className="model-limits">
            <summary>Technical details</summary>
            <p className="small num">
              {model.name} {model.version}
            </p>
            <ol className="model-flow" aria-label="How a recording is analysed">
              {PIPELINE.map((p, i) => (
                <li key={p}>
                  <span className="num">{i + 1}</span>
                  {p}
                </li>
              ))}
            </ol>
            {model.limitations.length > 0 && (
              <ul className="small">
                {model.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
          </details>
        </>
      )}
    </section>
  );
}

// --- getting started ---------------------------------------------------------------
// Three steps from a new account to the first check. Each step's state is
// read from the user's stored machines and results; nothing is assumed.

type StartStep = { n: number; title: string; detail: string; href: string; state: "done" | "current" | "todo" };

export function gettingStartedSteps(machines: MachineOverview[], analysesTotal: number): StartStep[] {
  const analysable = machines.filter((m) => machineStatus(m) !== "unsupported");
  const needsBaseline = analysable.find((m) => m.baselineCount < BASELINE_REQUIRED);
  const ready = analysable.find((m) => m.baselineCount >= BASELINE_REQUIRED);
  const registered = machines.length > 0;
  const baselineDone = ready !== undefined;
  const checked = analysesTotal > 0;

  const step2Target = needsBaseline ?? analysable[0];
  const steps: Omit<StartStep, "state">[] = [
    {
      n: 1,
      title: "Register your machine",
      detail: registered
        ? `${machines.length} machine${machines.length === 1 ? "" : "s"} registered`
        : "Choose a bearing or gearbox and give it a name",
      href: "/machines/new",
    },
    {
      n: 2,
      title: "Upload normal operating recordings",
      detail: baselineDone
        ? `${ready!.name} has ${ready!.baselineCount} baseline recordings`
        : step2Target
          ? `${step2Target.name}: ${step2Target.baselineCount}/${BASELINE_REQUIRED} so far`
          : `At least ${BASELINE_REQUIRED} recordings of a bearing or gearbox running normally`,
      href: step2Target ? `/machines/${step2Target.id}#baseline` : "/machines/new",
    },
    {
      n: 3,
      title: "Run your first acoustic check",
      detail: checked
        ? "First check done"
        : ready
          ? `${ready.name} is ready for its first check`
          : "Available once a machine has its baseline",
      href: ready ? `/machines/${ready.id}#check` : step2Target ? `/machines/${step2Target.id}#baseline` : "/machines/new",
    },
  ];
  const done = [registered, baselineDone, checked];
  const current = done.findIndex((d) => !d);
  return steps.map((s, i) => ({ ...s, state: done[i] ? "done" : i === current ? "current" : "todo" }));
}

export function GettingStarted({
  machines,
  analysesTotal,
  variant,
}: {
  machines: MachineOverview[];
  analysesTotal: number;
  variant: "welcome" | "strip";
}) {
  const steps = gettingStartedSteps(machines, analysesTotal);
  const doneCount = steps.filter((s) => s.state === "done").length;
  const welcome = variant === "welcome";
  return (
    <section className={`card getting-started${welcome ? " is-welcome" : ""}`} aria-labelledby="gs-title">
      <div className="gs-head">
        <div>
          {welcome && <p className="eyebrow">First steps</p>}
          <h2 id="gs-title">{welcome ? "Welcome to Sonovate" : "Getting started"}</h2>
          <p className="muted">
            {welcome
              ? "Start monitoring a machine in three simple steps."
              : "Finish setting up to run your first acoustic check."}
          </p>
        </div>
        <span className="gs-count num" aria-label={`${doneCount} of 3 steps done`}>
          {doneCount}/3
        </span>
      </div>
      <ol className="gs-steps">
        {steps.map((s) => (
          <li key={s.n} className={`gs-step is-${s.state}`}>
            <Link href={s.href} className="gs-link" aria-current={s.state === "current" ? "step" : undefined}>
              <span className="gs-mark num" aria-hidden="true">
                {s.state === "done" ? "✓" : s.n}
              </span>
              <span className="gs-text">
                <strong>{s.title}</strong>
                <span className="muted small">{s.detail}</span>
              </span>
              <span className="visually-hidden">
                {s.state === "done" ? "(done)" : s.state === "current" ? "(next step)" : ""}
              </span>
              {Icons.arrow}
            </Link>
          </li>
        ))}
      </ol>
      {welcome && (
        <div className="actions">
          <Link href="/machines/new" className="btn btn-primary">
            {Icons.plus} Add your first machine
          </Link>
          <Link href="/guide" className="btn btn-ghost">
            Read the guide
          </Link>
        </div>
      )}
    </section>
  );
}

// --- operator overview (Milestone: usable results) ------------------------------------
// Four counts that are exact from stored rows, one recommended next step, a
// compact machine table and an activity list. Nothing here is a health level.

export function toDashMachine(m: MachineOverview): DashMachine {
  const last = m.recent[m.recent.length - 1] ?? null;
  return {
    id: m.id,
    name: m.name,
    analysable: overviewState(m) !== "records_only",
    baselineCount: m.baselineCount,
    alert: m.alert?.alert === true,
    latestCheck: last ? { above: last.above, created_at: last.created_at, recording_id: last.recording_id } : null,
  };
}

export function OverviewStrip({ machines, recentAnalyses }: { machines: MachineOverview[]; recentAnalyses: number | null }) {
  const c = overviewCounts(machines.map(toDashMachine));
  const tiles: { label: string; value: ReactNode; note: string; warn?: boolean }[] = [
    { label: "Machines", value: c.machines, note: "Registered" },
    {
      label: "Needing attention",
      value: c.attention,
      note: "Machine alert or latest check above threshold",
      warn: c.attention > 0,
    },
    { label: "Recent analyses", value: recentAnalyses ?? "—", note: "In the last 7 days" },
    { label: "Ready for a check", value: c.ready, note: `Baseline of ${BASELINE_REQUIRED}+ normal recordings` },
  ];
  return (
    <ul className="ov-strip" aria-label="Overview">
      {tiles.map((t) => (
        <li key={t.label} className={t.warn ? "is-warn" : undefined}>
          <span className="ov-value num">{t.value}</span>
          <span className="ov-label">{t.label}</span>
          <span className="ov-note muted small">{t.note}</span>
        </li>
      ))}
    </ul>
  );
}

export function NextStepCard({ machines }: { machines: MachineOverview[] }) {
  const action = accountNextAction(machines.map(toDashMachine));
  let title: string;
  let body: string;
  let primary: { href: string; label: string } | null = null;
  let secondary: { href: string; label: string } | null = null;
  switch (action.kind) {
    case "register":
      title = "Register your first machine";
      body = "Choose a bearing or gearbox and give it a name. Then record its normal sound.";
      primary = { href: "/machines/new", label: "Add machine" };
      break;
    case "attention": {
      const m = action.machine;
      title = `Review ${m.name}`;
      body = m.alert
        ? "Repeated checks were above this machine's threshold. Open its latest result, listen to it, and inspect the machine. This is not a diagnosis."
        : "Its latest check was above this machine's threshold: unusual compared with its baseline. Open the result and listen to it; one unusual check does not confirm a fault.";
      primary = action.recordingId
        ? { href: `/recordings/${action.recordingId}`, label: "Open latest result" }
        : { href: `/machines/${m.id}`, label: "Open machine" };
      if (action.recordingId) secondary = { href: `/machines/${m.id}`, label: "Open machine" };
      break;
    }
    case "baseline": {
      const m = action.machine;
      const left = Math.max(0, BASELINE_REQUIRED - m.baselineCount);
      title = `Continue baseline setup for ${m.name}`;
      body = `${m.baselineCount} of ${BASELINE_REQUIRED} normal recordings so far. Add ${left} more, made while it runs as usual, before its first check.`;
      primary = { href: `/machines/${m.id}#baseline`, label: "Add baseline recordings" };
      break;
    }
    case "first_check":
      title = `Analyse a first recording of ${action.machine.name}`;
      body = "Its baseline is ready. Upload a recording (60 seconds recommended) to compare it with the baseline.";
      primary = { href: `/machines/${action.machine.id}#check`, label: "Analyse a recording" };
      break;
    case "check":
      title = "No machine needs attention right now";
      body = `${action.machine.name} was checked longest ago. Analyse a new recording to keep monitoring. No attention flag does not confirm a machine is fault-free.`;
      primary = { href: `/machines/${action.machine.id}#check`, label: `Analyse ${action.machine.name}` };
      break;
    case "records_only":
      title = "Nothing to analyse";
      body = "Your machines are stored for record keeping only. Add a bearing or gearbox to use acoustic checks.";
      primary = { href: "/machines/new", label: "Add machine" };
      break;
  }
  const warn = action.kind === "attention";
  return (
    <section className={`card next-step${warn ? " is-warn" : ""}`} aria-labelledby="next-step-title">
      <p className="eyebrow">Next step</p>
      <h2 id="next-step-title">{title}</h2>
      <p className="muted">{body}</p>
      <div className="actions">
        {primary && (
          <Link href={primary.href} className="btn btn-primary btn-sm">
            {primary.label} {Icons.arrow}
          </Link>
        )}
        {secondary && (
          <Link href={secondary.href} className="btn btn-outline btn-sm">
            {secondary.label}
          </Link>
        )}
      </div>
    </section>
  );
}

function baselineStatus(m: MachineOverview): { text: string; done: boolean } {
  if (m.baselineCount >= BASELINE_REQUIRED) return { text: `Complete · ${m.baselineCount}`, done: true };
  return { text: `${m.baselineCount} of ${BASELINE_REQUIRED}`, done: false };
}

/** The machine's row action: what to do next for it. */
function rowAction(m: MachineOverview): { href: string; label: string; primary: boolean } {
  const d = toDashMachine(m);
  const reason = attentionReason(d);
  if (reason && d.latestCheck) return { href: `/recordings/${d.latestCheck.recording_id}`, label: "Open result", primary: true };
  if (!d.analysable) return { href: `/machines/${m.id}`, label: "Open", primary: false };
  if (m.baselineCount < BASELINE_REQUIRED) return { href: `/machines/${m.id}#baseline`, label: "Add baselines", primary: false };
  if (!d.latestCheck) return { href: `/machines/${m.id}#check`, label: "Analyse", primary: false };
  return { href: `/machines/${m.id}`, label: "Open", primary: false };
}

export function MachineTable({ machines }: { machines: MachineOverview[] }) {
  const rows = [...machines].sort((a, b) => {
    const ra = attentionReason(toDashMachine(a));
    const rb = attentionReason(toDashMachine(b));
    const rank = (r: AttentionReason | null) => (r === "alert" ? 0 : r === "latest_above" ? 1 : 2);
    return rank(ra) - rank(rb) || a.name.localeCompare(b.name);
  });
  return (
    <div className="mtable-wrap">
      <table className="mtable">
        <thead>
          <tr>
            <th scope="col">Machine</th>
            <th scope="col">Baseline</th>
            <th scope="col">Latest analysis</th>
            <th scope="col">Last analysed</th>
            <th scope="col">
              <span className="visually-hidden">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const d = toDashMachine(m);
            const reason = attentionReason(d);
            const base = baselineStatus(m);
            const action = rowAction(m);
            return (
              <tr key={m.id} className={reason ? "is-attention" : undefined}>
                <th scope="row" data-label="Machine">
                  <Link href={`/machines/${m.id}`} className="mtable-name">
                    {m.name}
                  </Link>
                  <span className="muted small mtable-type">{machineTypeLabel(m.machine_type)}</span>
                  {reason && (
                    <span className="attention-flag small">
                      {Icons.alert}
                      {reason === "alert" ? "Machine alert" : "Needs attention"}
                      <span className="visually-hidden">: {ATTENTION_TEXT[reason]}</span>
                    </span>
                  )}
                </th>
                <td data-label="Baseline">
                  {d.analysable ? (
                    <span className={base.done ? undefined : "mtable-pending"}>{base.text}</span>
                  ) : (
                    <span className="muted">Records only</span>
                  )}
                </td>
                <td data-label="Latest analysis">
                  {d.latestCheck ? (
                    <span className={`decision-pill${d.latestCheck.above ? " is-above" : ""}`}>
                      {d.latestCheck.above ? ABOVE_LABEL : WITHIN_LABEL}
                    </span>
                  ) : (
                    <span className="muted small">{d.analysable ? "Not analysed yet" : "—"}</span>
                  )}
                </td>
                <td data-label="Last analysed" className="small">
                  {d.latestCheck ? (
                    <span title={formatDateTime(d.latestCheck.created_at)}>{relativeTime(d.latestCheck.created_at)}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="mtable-action">
                  <Link
                    href={action.href}
                    className={`btn btn-sm ${action.primary ? "btn-primary" : "btn-outline"}`}
                    aria-label={`${action.label}: ${m.name}`}
                  >
                    {action.label}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ActivityPanel({ items, error }: { items: Activity[] | null; error: string | null }) {
  return (
    <section className="panel" aria-labelledby="activity-title">
      <div className="panel-head">
        <h2 id="activity-title">Recent activity</h2>
        <span className="muted small">Latest first</span>
      </div>
      {error && <p className="small panel-empty">{error}</p>}
      {!error && items === null && <SkeletonBlock lines={3} />}
      {items?.length === 0 && (
        <EmptyState title="Nothing yet">Analyses, machine alerts and baseline uploads will appear here.</EmptyState>
      )}
      {items && items.length > 0 && (
        <ul className="feed">
          {items.map((a) => {
            const key = `${a.kind}-${a.at}-${a.machineId}`;
            if (a.kind === "analysis") {
              return (
                <li key={key}>
                  <Link href={`/recordings/${a.recordingId}`} className="feed-item">
                    <span className="feed-top">
                      <strong>{a.machineName}</strong>
                      <span className={`decision-pill${a.above ? " is-above" : ""}`}>{a.above ? ABOVE_LABEL : WITHIN_LABEL}</span>
                    </span>
                    <span className="feed-meta">
                      <span>Check analysed</span>
                      <span title={formatDateTime(a.at)}>{relativeTime(a.at)}</span>
                      <span>Open result</span>
                    </span>
                  </Link>
                </li>
              );
            }
            if (a.kind === "alert") {
              return (
                <li key={key}>
                  <Link href={`/machines/${a.machineId}#alert`} className="feed-item">
                    <span className="feed-top">
                      <strong>{a.machineName}</strong>
                      <span className="decision-pill is-above">Machine alert</span>
                    </span>
                    <span className="feed-meta">
                      <span>{a.ended ? "Alert started (since cleared)" : "Alert started"}</span>
                      <span title={formatDateTime(a.at)}>{relativeTime(a.at)}</span>
                    </span>
                  </Link>
                </li>
              );
            }
            return (
              <li key={key}>
                <Link href={`/machines/${a.machineId}#baseline`} className="feed-item">
                  <span className="feed-top">
                    <strong>{a.machineName}</strong>
                    <span className="decision-pill">Baseline</span>
                  </span>
                  <span className="feed-meta">
                    <span>
                      {a.count} normal recording{a.count === 1 ? "" : "s"} added
                    </span>
                    <span title={formatDateTime(a.at)}>{relativeTime(a.at)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function buildActivity(
  machines: MachineOverview[],
  analyses: RecentAnalysis[],
  episodes: AlertEpisode[],
  limit = 8,
): Activity[] {
  const names = new Map(machines.map((m) => [m.id, m.name]));
  const items: Activity[] = [
    ...analyses.map(
      (a): Activity => ({
        kind: "analysis",
        at: a.created_at,
        machineId: a.machine?.id ?? null,
        machineName: a.machine?.name ?? "Machine",
        recordingId: a.recording_id,
        above: a.decision === "above_threshold",
      }),
    ),
    ...episodes
      .filter((e) => names.has(e.machine_id))
      .map(
        (e): Activity => ({
          kind: "alert",
          at: e.started_at,
          machineId: e.machine_id,
          machineName: names.get(e.machine_id)!,
          ended: e.ended_at !== null,
        }),
      ),
    ...groupBaselineUploads(
      machines.flatMap((m) => m.baselineAddedAt.map((at) => ({ machineId: m.id, machineName: m.name, created_at: at }))),
    ),
  ];
  return activityFeed(items, limit);
}
