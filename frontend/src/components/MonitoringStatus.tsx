import Link from "next/link";
import type { ReactNode } from "react";
import type { MachineOverview } from "@/lib/api";
import { MODEL_INPUTS } from "@/lib/modelInputs";
import { STATE_LABEL, monitoringState, type MonitoringState } from "@/lib/monitoring";

// Shared status pieces. One research-prototype notice per page (ADR-007),
// a status badge in plain language, and the alert rule behind a disclosure
// instead of repeated on every card.

export const PROTOTYPE_SHORT = "Research prototype: low sensitivity, not a diagnosis or failure prediction.";

export function overviewState(m: MachineOverview): MonitoringState {
  return monitoringState({
    analysable: MODEL_INPUTS[m.machine_type].length > 0,
    baselineCount: m.baselineCount,
    checksWithResult: m.checksWithResult,
    alert: m.alert?.alert === true,
  });
}

export function StatusBadge({ state }: { state: MonitoringState }) {
  return (
    <span className={`mstatus is-${state}`}>
      <span className="mstatus-dot" aria-hidden="true" />
      {STATE_LABEL[state]}
    </span>
  );
}

/** The single prototype notice shown once per page. */
export function PrototypeNotice({ children }: { children?: ReactNode }) {
  return (
    <p className="proto-note" role="note">
      <span className="proto-tag">Prototype</span>
      <span>
        {PROTOTYPE_SHORT} {children}
      </span>
    </p>
  );
}

/** ADR-009 rule, available on demand. */
export function HowAlertsWork({ compact = false }: { compact?: boolean }) {
  return (
    <details className={`how-alerts${compact ? " is-compact" : ""}`}>
      <summary>How alerts work</summary>
      <div className="how-alerts-body small">
        <p>
          A machine alert is raised when at least <strong>2 of the last 3</strong> checks were above this
          machine&apos;s baseline threshold. A single unusual check does not raise one.
        </p>
        <p>
          The rule was chosen on simulated timelines, not real machine histories, and with the current detector it
          misses most faults. No alert does not mean the machine is fault-free.
        </p>
        <p>
          <Link href="/guide#alerts">Read more in the guide</Link>
        </p>
      </div>
    </details>
  );
}

// --- loading and empty states --------------------------------------------------

export function SkeletonBlock({ lines = 3, tall = false }: { lines?: number; tall?: boolean }) {
  return (
    <div className={`sk-block${tall ? " is-tall" : ""}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton" />
      ))}
    </div>
  );
}

/** Page-level loading: a header and two cards of placeholders, announced once. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="page-skeleton" role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      <div className="sk-head" aria-hidden="true">
        <span className="skeleton" />
        <span className="skeleton" />
      </div>
      <div className="card">
        <SkeletonBlock lines={4} />
      </div>
      <div className="card">
        <SkeletonBlock lines={3} />
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-block">
      <p className="empty-block-title">{title}</p>
      {children && <p className="muted small">{children}</p>}
      {action && <div className="empty-block-action">{action}</div>}
    </div>
  );
}
