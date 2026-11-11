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
  type MachineOverview,
  type ModelVersionInfo,
  type RecentAnalysis,
  type ServiceStatus,
} from "@/lib/api";
import { machineTypeLabel } from "@/lib/modelInputs";
import { ATTENTION_ORDER, nextAction, stateSummary, type MonitoringState } from "@/lib/monitoring";
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
    <header className="dash-head theme-dark">
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
                      {above ? "Unusual" : "Similar to normal"}
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
