"use client";

import Link from "next/link";
import { BASELINE_RECOMMENDED, BASELINE_REQUIRED, type HistoryEntry, type Machine, type MachineAlert } from "@/lib/api";
import { machineTypeLabel } from "@/lib/modelInputs";
import { stateSummary, type MonitoringState } from "@/lib/monitoring";
import { analysedPoints } from "./MachineInsights";
import { HowAlertsWork, StatusBadge } from "./MonitoringStatus";
import { BaselineProgress } from "./RecordingWorkbench";
import { formatDateTime } from "./Status";

// The top of a machine page, chosen by its lifecycle state:
// setting up (< 10 baselines), monitoring (with or without results), or alert.

export function SetupModule({
  machine,
  baselineCount,
  onAddBaselines,
}: {
  machine: Machine;
  baselineCount: number;
  onAddBaselines: () => void;
}) {
  const left = Math.max(0, BASELINE_REQUIRED - baselineCount);
  return (
    <section className="card state-module is-setup" aria-labelledby="setup-module-title">
      <div className="state-head">
        <div>
          <p className="eyebrow">Setting up · {machineTypeLabel(machine.machine_type)}</p>
          <h2 id="setup-module-title">Establish {machine.name}&apos;s normal sound</h2>
          <p className="muted">
            {left > 0
              ? `${left} more normal recording${left === 1 ? "" : "s"} needed before the first check.`
              : "Minimum reached."}{" "}
            Minimum {BASELINE_REQUIRED}, recommended {BASELINE_RECOMMENDED}.
          </p>
        </div>
        <StatusBadge state="baseline_incomplete" />
      </div>
      <BaselineProgress count={baselineCount} />
      <div className="setup-guide">
        <ul className="small">
          <li>Record while the machine runs as it normally does, with nothing unusual going on.</li>
          <li>Keep the phone or microphone in the same place and at the same distance each time.</li>
          <li>Each recording needs at least 10 seconds; record at different normal settings if the machine has them.</li>
        </ul>
        <button type="button" onClick={onAddBaselines}>
          Add baseline recordings
        </button>
      </div>
    </section>
  );
}

export function MonitoringHeader({
  machine,
  state,
  baselineCount,
  entries,
  onRunCheck,
}: {
  machine: Machine;
  state: MonitoringState;
  baselineCount: number;
  entries: HistoryEntry[];
  onRunCheck: () => void;
}) {
  const points = analysedPoints(entries);
  const latest = points[points.length - 1] ?? null;
  return (
    <section className={`card state-module is-${state}`} aria-labelledby="monitor-title">
      <div className="state-head">
        <div>
          <p className="eyebrow">Monitoring · {machineTypeLabel(machine.machine_type)}</p>
          <h2 id="monitor-title">
            {state === "alert" ? "Monitoring summary" : stateSummary(state, baselineCount)}
          </h2>
        </div>
        <StatusBadge state={state} />
      </div>
      <dl className="state-facts">
        <div>
          <dt>Normal references</dt>
          <dd className="num">{baselineCount}</dd>
        </div>
        <div>
          <dt>Checks with a result</dt>
          <dd className="num">{points.length}</dd>
        </div>
        <div>
          <dt>Latest check</dt>
          <dd>
            {latest ? (
              <Link href={`/recordings/${latest.recordingId}`}>
                {latest.above ? "Unusual" : "Similar to normal"} · {formatDateTime(latest.analysedAt)}
              </Link>
            ) : (
              <span className="muted">None yet</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Machine alert</dt>
          <dd>{state === "alert" ? <strong className="mcard-above">Active</strong> : "None current"}</dd>
        </div>
      </dl>
      <div className="actions">
        <button type="button" onClick={onRunCheck}>
          {points.length === 0 ? "Run first check" : "Run a new check"}
        </button>
        {state !== "alert" && <HowAlertsWork compact />}
      </div>
    </section>
  );
}

// State C: shown above everything else while the ADR-009 alert is active.
export function AlertPanel({ alert, entries }: { alert: MachineAlert; entries: HistoryEntry[] }) {
  const points = analysedPoints(entries);
  const lastThree = points.slice(-3);
  const latest = points[points.length - 1];
  return (
    <section id="alert" className="card alert-panel" aria-labelledby="alert-panel-title" tabIndex={-1}>
      <div className="alert-panel-head">
        <span className="alert-panel-icon" aria-hidden="true">
          !
        </span>
        <div>
          <h2 id="alert-panel-title">Repeated unusual readings</h2>
          <p>
            Repeated checks have been above this machine&apos;s baseline threshold. Inspect the machine and review its
            recordings.
          </p>
        </div>
      </div>
      <p className="small">
        <strong className="num">{alert.above_threshold_count}</strong> of the last{" "}
        <span className="num">{alert.analyses_considered}</span> checks above threshold · last checked{" "}
        {formatDateTime(alert.last_analysed_at)}
      </p>
      {lastThree.length > 0 && (
        <ol className="alert-last3" aria-label="Last three checks, oldest first">
          {lastThree.map((p) => (
            <li key={p.recordingId} className={p.above ? "is-above" : "is-below"}>
              <Link href={`/recordings/${p.recordingId}`}>
                <span className="alert-last3-word">{p.above ? "Above · unusual" : "Below · similar"}</span>
                <span className="muted small">{formatDateTime(p.analysedAt)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      <div className="actions">
        {latest && (
          <Link href={`/recordings/${latest.recordingId}`} className="btn btn-primary btn-sm">
            Open latest check
          </Link>
        )}
        {latest && (
          <Link href={`/recordings/${latest.recordingId}#listen`} className="btn btn-outline btn-sm">
            Listen &amp; compare
          </Link>
        )}
        <HowAlertsWork compact />
      </div>
      <p className="muted small">This is not a diagnosis or a failure prediction.</p>
    </section>
  );
}

export function LatestResultCard({ entries }: { entries: HistoryEntry[] }) {
  const points = analysedPoints(entries);
  const latest = points[points.length - 1];
  if (!latest) return null;
  const entry = entries.find((e) => e.id === latest.recordingId);
  const windows = entry?.predictions.find((p) => p.created_at === latest.analysedAt)?.window_count ?? null;
  return (
    <section className={`card latest-result ${latest.above ? "is-above" : "is-below"}`} aria-labelledby="latest-title">
      <div className="card-header">
        <h2 id="latest-title">Latest result</h2>
        <span className="muted small">{formatDateTime(latest.analysedAt)}</span>
      </div>
      <p className="latest-verdict">
        {latest.above ? "Unusual compared with this machine's normal sound." : "Similar to this machine's normal sound."}
      </p>
      <p className="muted small">
        {latest.above
          ? "Worth inspecting; this does not confirm a fault."
          : "This does not guarantee that the machine is fault-free."}
        {windows ? ` Judged on ${windows} ten-second window${windows === 1 ? "" : "s"}.` : ""}
      </p>
      <div className="actions">
        <Link href={`/recordings/${latest.recordingId}`} className="button-like btn-sm">
          Open result
        </Link>
        <Link href={`/recordings/${latest.recordingId}#listen`} className="button-like btn-sm">
          Listen &amp; compare
        </Link>
      </div>
    </section>
  );
}
