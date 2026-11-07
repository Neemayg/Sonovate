"use client";

// Building blocks of the signed-in overview (/machines). Everything shown is
// read from the user's own data or the model registry: no invented scores,
// trends or health levels. Positions relative to a threshold are positions,
// not probabilities.

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  BASELINE_REQUIRED,
  type MachineOverview,
  type ModelVersionInfo,
  type RecentAnalysis,
  type ServiceStatus,
} from "@/lib/api";
import { machineTypeLabel } from "@/lib/modelInputs";
import { SignalBars } from "./Decor";
import { machineStatus, type MachineStatus } from "./MachineCard";
import { formatDateTime } from "./Status";

// --- helpers ------------------------------------------------------------------

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function displayName(email: string | undefined): string {
  const local = (email ?? "").split("@")[0]?.split(/[._-]+/)[0] ?? "";
  return local ? local[0].toUpperCase() + local.slice(1) : "there";
}

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

// --- hero ---------------------------------------------------------------------

const SERVICE_LABEL: Record<ServiceStatus | "checking", string> = {
  checking: "Checking analysis service…",
  online: "Analysis service online",
  unreachable: "Analysis service unreachable",
  not_configured: "Analysis service not configured",
};

export function DashHero({
  email,
  machines,
  service,
  model,
  onAdd,
}: {
  email: string | undefined;
  machines: MachineOverview[] | null;
  service: ServiceStatus | "checking";
  model: ModelVersionInfo | null;
  onAdd: () => void;
}) {
  const alerts = machines?.filter((m) => m.alert?.alert).length ?? 0;
  const waiting = machines?.filter((m) => machineStatus(m) === "needs_baseline").length ?? 0;
  let summary = "Loading your machines…";
  if (machines) {
    if (machines.length === 0) summary = "Add your first machine to start building its baseline.";
    else if (alerts > 0)
      summary = `${alerts} ${alerts === 1 ? "machine has" : "machines have"} a machine alert worth checking.`;
    else if (waiting > 0)
      summary = `${waiting} ${waiting === 1 ? "machine needs" : "machines need"} more baseline recordings before analysis.`;
    else summary = "No machine alerts right now. No alert does not mean no fault.";
  }

  return (
    <section className="dash-hero theme-dark" aria-labelledby="dash-title">
      <div className="dash-hero-glow" aria-hidden="true" />
      <div className="dash-hero-grid" aria-hidden="true" />
      <div className="dash-hero-copy">
        <p className="eyebrow">Overview · {formatDateTime(new Date().toISOString())}</p>
        <h1 id="dash-title">
          {greeting()}, <em>{displayName(email)}</em>
        </h1>
        <p className="dash-hero-summary">{summary}</p>
        <div className="dash-chips">
          <span className={`chip chip-service is-${service}`} role="status">
            <span className="chip-dot" aria-hidden="true" />
            {SERVICE_LABEL[service]}
          </span>
          {model && (
            <span className="chip">
              <span className="chip-key">Model</span>
              <span className="num">
                {model.name} {model.version}
              </span>
            </span>
          )}
          <span className="chip">
            <span className="chip-key">Baseline</span>
            <span className="num">{BASELINE_REQUIRED} recordings / machine</span>
          </span>
        </div>
        <div className="dash-hero-actions">
          <button type="button" className="btn btn-primary" onClick={onAdd}>
            {Icons.plus} Add machine
          </button>
          <Link href="/guide" className="btn btn-ghost">
            User guide
          </Link>
        </div>
      </div>
      <div className="dash-hero-visual" aria-hidden="true">
        <SignalBars count={48} seed={2.4} />
      </div>
    </section>
  );
}

// --- KPI tiles ----------------------------------------------------------------

function Ring({ value, max }: { value: number; max: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <svg className="ring" width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r={r} className="ring-track" />
      <circle
        cx="28"
        cy="28"
        r={r}
        className="ring-value"
        strokeDasharray={c}
        style={{ "--offset": c * (1 - frac), "--full": c } as CSSProperties}
      />
    </svg>
  );
}

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
  const baselineTotal = machines.reduce((n, m) => n + m.baselineCount, 0);

  return (
    <ul className="kpis" aria-label="Summary">
      <li className="kpi" style={{ "--d": "0ms" } as CSSProperties}>
        <span className="kpi-icon">{Icons.machine}</span>
        <span className="kpi-label">Machines</span>
        <span className="kpi-value num">{machines.length}</span>
        <span className="kpi-note">
          {bearings} bearing{bearings === 1 ? "" : "s"} · {gearboxes} gearbox{gearboxes === 1 ? "" : "es"}
        </span>
      </li>
      <li className="kpi kpi-ring" style={{ "--d": "70ms" } as CSSProperties}>
        <span className="kpi-icon">{Icons.baseline}</span>
        <span className="kpi-label">Baseline ready</span>
        <span className="kpi-value num">
          {ready}
          <small>/{analysable.length}</small>
        </span>
        <span className="kpi-note">{baselineTotal} baseline recordings in total</span>
        <Ring value={ready} max={analysable.length} />
      </li>
      <li className="kpi" style={{ "--d": "140ms" } as CSSProperties}>
        <span className="kpi-icon">{Icons.analysis}</span>
        <span className="kpi-label">Analyses run</span>
        <span className="kpi-value num">{analyses ? analyses.total : "—"}</span>
        <span className="kpi-note">
          {analyses?.latest ? `Latest ${relativeTime(analyses.latest)}` : "No analyses yet"}
        </span>
      </li>
      <li className={`kpi${alerts > 0 ? " is-warn" : ""}`} style={{ "--d": "210ms" } as CSSProperties}>
        <span className="kpi-icon">{Icons.alert}</span>
        <span className="kpi-label">Machine alerts</span>
        <span className="kpi-value num">{alerts}</span>
        <span className="kpi-note">2 of the last 3 analyses above threshold</span>
      </li>
    </ul>
  );
}

// --- machine filters ------------------------------------------------------------

export type MachineFilter = "all" | "alert" | MachineStatus;

const FILTERS: { id: MachineFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "alert", label: "Alerts" },
  { id: "needs_baseline", label: "Needs baseline" },
  { id: "ready", label: "Ready" },
  { id: "has_result", label: "With results" },
];

export function matchesFilter(m: MachineOverview, f: MachineFilter): boolean {
  if (f === "all") return true;
  if (f === "alert") return m.alert?.alert === true;
  return machineStatus(m) === f;
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

type Step = { key: string; tone: "warn" | "info" | "plain"; title: ReactNode; detail: string; href: string };

function nextSteps(machines: MachineOverview[]): Step[] {
  const steps: Step[] = [];
  for (const m of machines) {
    if (m.alert?.alert) {
      steps.push({
        key: `alert-${m.id}`,
        tone: "warn",
        title: <>Check {m.name}</>,
        detail: `${m.alert.above_threshold_count} of the last ${m.alert.analyses_considered} analyses above its threshold`,
        href: `/machines/${m.id}/history`,
      });
    }
  }
  for (const m of machines) {
    const status = machineStatus(m);
    if (status === "needs_baseline") {
      const left = BASELINE_REQUIRED - m.baselineCount;
      steps.push({
        key: `base-${m.id}`,
        tone: "info",
        title: <>Record {left} more baseline{left === 1 ? "" : "s"}</>,
        detail: `${m.name} · ${m.baselineCount}/${BASELINE_REQUIRED} so far`,
        href: `/machines/${m.id}`,
      });
    } else if (status === "ready") {
      steps.push({
        key: `ready-${m.id}`,
        tone: "plain",
        title: <>Analyse a new recording</>,
        detail: `${m.name} · baseline ready, no analysis yet`,
        href: `/machines/${m.id}`,
      });
    }
  }
  return steps.slice(0, 4);
}

export function NextStepsPanel({ machines, onAdd }: { machines: MachineOverview[]; onAdd: () => void }) {
  const steps = nextSteps(machines);
  return (
    <section className="panel" aria-labelledby="next-title">
      <div className="panel-head">
        <h2 id="next-title">Next steps</h2>
      </div>
      {machines.length === 0 ? (
        <button type="button" className="step-item step-item-button" onClick={onAdd}>
          <span className="step-dot is-info" aria-hidden="true" />
          <span>
            <strong>Add your first machine</strong>
            <span>A bearing or gearbox you can record</span>
          </span>
          {Icons.arrow}
        </button>
      ) : steps.length === 0 ? (
        <p className="muted small panel-empty">Nothing waiting. Upload new recordings from a machine&apos;s page.</p>
      ) : (
        <ul className="step-list">
          {steps.map((s) => (
            <li key={s.key}>
              <Link href={s.href} className="step-item">
                <span className={`step-dot is-${s.tone}`} aria-hidden="true" />
                <span>
                  <strong>{s.title}</strong>
                  <span>{s.detail}</span>
                </span>
                {Icons.arrow}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Same mapping as ScoreStrip: a log-score axis centred on the threshold.
function MiniStrip({ logScore, threshold }: { logScore: number; threshold: number }) {
  const distance = logScore - threshold;
  const span = Math.max(Math.abs(distance) * 1.6, 0.25);
  const x = Math.min(Math.max(((logScore - (threshold - span)) / (2 * span)) * 100, 4), 96);
  return (
    <span className="mini-strip" aria-hidden="true">
      <span className="mini-zone" />
      <span className="mini-threshold" />
      <span className="mini-marker" style={{ left: `${x}%` }} />
    </span>
  );
}

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
        <h2 id="recent-title">Recent analyses</h2>
        <span className="muted small">Latest first</span>
      </div>
      {error && <p className="small panel-empty">{error}</p>}
      {!error && items === null && (
        <div className="panel-skeleton" aria-hidden="true">
          <span className="skeleton" />
          <span className="skeleton" />
          <span className="skeleton" />
        </div>
      )}
      {items?.length === 0 && (
        <p className="muted small panel-empty">
          No analyses yet. Once a machine has {BASELINE_REQUIRED} baseline recordings, upload a new recording and run an
          analysis.
        </p>
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
                      {above ? "Above threshold" : "Below threshold"}
                    </span>
                  </span>
                  {a.log_score !== null && <MiniStrip logScore={a.log_score} threshold={a.threshold} />}
                  <span className="feed-meta">
                    <span title={formatDateTime(a.created_at)}>{relativeTime(a.created_at)}</span>
                    {a.machine && <span>{machineTypeLabel(a.machine.machine_type)}</span>}
                    {a.log_score !== null && (
                      <span className="num">
                        log score {a.log_score.toFixed(3)} / {a.threshold.toFixed(3)}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="panel-foot">Positions are relative to each machine&apos;s own threshold, not probabilities.</p>
    </section>
  );
}

const PIPELINE = ["10 s WAV, 16 kHz", "Frozen AST encoder", "kNN distance to baseline", "Per-machine threshold", "2-of-3 alert"];

export function ModelPanel({ model, error }: { model: ModelVersionInfo | null | undefined; error: string | null }) {
  return (
    <section id="dash-model" className="panel panel-model" aria-labelledby="model-title">
      <div className="panel-head">
        <h2 id="model-title">Analysis model</h2>
        <span className="tag">Research prototype</span>
      </div>
      {error && <p className="small panel-empty">{error}</p>}
      {model === undefined && !error && (
        <div className="panel-skeleton" aria-hidden="true">
          <span className="skeleton" />
          <span className="skeleton" />
        </div>
      )}
      {model === null && !error && <p className="muted small panel-empty">No model is registered.</p>}
      {model && (
        <>
          <div className="model-id">
            <span className="model-badge" aria-hidden="true">
              AST
            </span>
            <div>
              <strong className="num">{model.name}</strong>
              <span className="muted small">
                Version <span className="num">{model.version}</span> ·{" "}
                {model.machine_type ? machineTypeLabel(model.machine_type) : "Bearings and gearboxes"}
              </span>
            </div>
          </div>
          <ol className="model-flow" aria-label="How a recording is analysed">
            {PIPELINE.map((p, i) => (
              <li key={p} style={{ "--i": i } as CSSProperties}>
                <span className="num">{i + 1}</span>
                {p}
              </li>
            ))}
          </ol>
          {model.limitations.length > 0 && (
            <details className="model-limits">
              <summary>Known limitations ({model.limitations.length})</summary>
              <ul>
                {model.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <p className="panel-foot">Each result records the model version that produced it.</p>
    </section>
  );
}
