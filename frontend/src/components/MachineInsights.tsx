"use client";

import Link from "next/link";
import type { HistoryEntry, Machine } from "@/lib/api";
import { MODEL_INPUTS, type MachineType } from "@/lib/modelInputs";
import { formatDateTime } from "./Status";

// Machine-page insights built only from stored rows: recordings, their
// operating context and the latest stored result for each analysed
// recording. No values are estimated or interpolated.

export type AnalysedPoint = {
  recordingId: string;
  filename: string;
  analysedAt: string;
  above: boolean;
  logScore: number | null;
  threshold: number;
};

/** Latest stored result per analysis recording, oldest first (as machine_alerts reads them). */
export function analysedPoints(entries: HistoryEntry[]): AnalysedPoint[] {
  const points: AnalysedPoint[] = [];
  for (const e of entries) {
    if (e.kind !== "analysis" || e.predictions.length === 0) continue;
    const latest = e.predictions.reduce((a, b) => (b.created_at > a.created_at ? b : a));
    points.push({
      recordingId: e.id,
      filename: e.original_filename ?? "Recording",
      analysedAt: latest.created_at,
      above: latest.decision === "above_threshold",
      logScore: latest.log_score,
      threshold: latest.threshold,
    });
  }
  return points.sort((a, b) => a.analysedAt.localeCompare(b.analysedAt));
}

// --- result timeline -----------------------------------------------------------
// Dots only, no connecting line: the scores are uncalibrated and a line would
// suggest a trend the evidence does not support. The last three are bracketed
// because the ADR-009 machine alert reads exactly those.

const WINDOW = 3;

export function ResultTimeline({ entries }: { entries: HistoryEntry[] }) {
  const points = analysedPoints(entries);
  if (points.length === 0) {
    return (
      <p className="empty small">
        No analysed recordings yet. Each analysis you run appears here as a dot, oldest on the left.
      </p>
    );
  }
  const above = points.filter((p) => p.above).length;
  const windowStart = Math.max(0, points.length - WINDOW);
  const inWindow = points.slice(windowStart);
  const windowAbove = inWindow.filter((p) => p.above).length;

  return (
    <div className="rt">
      <div className="rt-summary">
        <span>
          <strong className="num">{points.length}</strong> analysed
        </span>
        <span className="rt-sum-above">
          <strong className="num">{above}</strong> above threshold
        </span>
        <span className="rt-sum-below">
          <strong className="num">{points.length - above}</strong> below
        </span>
      </div>
      <ol className="rt-track" aria-label="Analysis results, oldest first">
        {points.map((p, i) => {
          const label = `${p.above ? "Above" : "Within"} threshold · ${formatDateTime(p.analysedAt)} · ${p.filename}`;
          return (
            <li
              key={p.recordingId}
              className={`rt-item ${p.above ? "is-above" : "is-below"}${i >= windowStart ? " in-window" : ""}${
                i === windowStart ? " window-start" : ""
              }${i === points.length - 1 ? " window-end" : ""}`}
            >
              <Link href={`/recordings/${p.recordingId}`} className="rt-dot" aria-label={label} title={label}>
                <span aria-hidden="true">{p.above ? "▲" : "●"}</span>
              </Link>
              <span className="rt-index num" aria-hidden="true">
                {i + 1}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="small muted rt-caption">
        The bracket marks the latest {inWindow.length}: <strong>{windowAbove}</strong> of them above threshold. The
        machine alert is raised when at least 2 of the last 3 are above. Dots are results, not a trend; select one to
        open it.
      </p>
    </div>
  );
}

// --- operating-condition coverage ----------------------------------------------
// ADR-006: the model does not use operating context; it compares the sound
// with every baseline recording. This panel only shows which settings the
// baselines were recorded at, so a user can see whether an analysis has a
// like-for-like baseline.

type Coverage = {
  name: string;
  label: string;
  unit: string;
  baseline: number[];
  analysed: { value: number; recordingId: string; filename: string }[];
};

function readValue(e: HistoryEntry, name: string, unit: string): number | null {
  const r = e.context_readings.find((c) => c.name === name && c.unit === unit);
  return r && Number.isFinite(r.value) ? r.value : null;
}

function coverage(type: MachineType, entries: HistoryEntry[]): Coverage[] {
  return MODEL_INPUTS[type].map((input) => {
    const baseline = new Set<number>();
    const analysed: Coverage["analysed"] = [];
    for (const e of entries) {
      const v = readValue(e, input.name, input.unit);
      if (v === null) continue;
      if (e.kind === "baseline") baseline.add(v);
      else analysed.push({ value: v, recordingId: e.id, filename: e.original_filename ?? "Recording" });
    }
    return {
      name: input.name,
      label: input.label,
      unit: input.unit,
      baseline: [...baseline].sort((a, b) => a - b),
      analysed,
    };
  });
}

export function ConditionCoverage({ machine, entries }: { machine: Machine; entries: HistoryEntry[] }) {
  const rows = coverage(machine.machine_type, entries);
  if (rows.length === 0) {
    return <p className="empty small">This machine type has no operating settings to compare.</p>;
  }
  return (
    <div className="cov">
      {rows.map((row) => {
        const uncovered = row.analysed.filter((a) => !row.baseline.includes(a.value));
        const analysedValues = [...new Set(row.analysed.map((a) => a.value))].sort((a, b) => a - b);
        return (
          <div key={row.name} className="cov-row">
            <h3 className="cov-title">
              {row.label} <span className="muted small">({row.unit})</span>
            </h3>
            {row.baseline.length === 0 && row.analysed.length === 0 ? (
              <p className="empty small">Not entered on any recording yet.</p>
            ) : (
              <dl className="cov-sets">
                <div>
                  <dt>Baselines recorded at</dt>
                  <dd>
                    {row.baseline.length === 0 ? (
                      <span className="muted small">none entered</span>
                    ) : (
                      row.baseline.map((v) => (
                        <span key={v} className="cov-chip is-baseline num">
                          {v} {row.unit}
                        </span>
                      ))
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Analyses recorded at</dt>
                  <dd>
                    {analysedValues.length === 0 ? (
                      <span className="muted small">none entered</span>
                    ) : (
                      analysedValues.map((v) => (
                        <span
                          key={v}
                          className={`cov-chip num ${row.baseline.includes(v) ? "is-covered" : "is-uncovered"}`}
                        >
                          {v} {row.unit}
                        </span>
                      ))
                    )}
                  </dd>
                </div>
              </dl>
            )}
            {uncovered.length > 0 && (
              <p className="notice small cov-note">
                {uncovered.length} {uncovered.length === 1 ? "analysis was" : "analyses were"} recorded at a setting no
                baseline covers (
                {uncovered.slice(0, 3).map((u, i) => (
                  <span key={u.recordingId}>
                    {i > 0 && ", "}
                    <Link href={`/recordings/${u.recordingId}`}>{u.filename}</Link>
                  </span>
                ))}
                {uncovered.length > 3 && ", …"}). Those results compare the sound with baselines from other settings.
                Adding baselines at that setting makes the comparison like-for-like.
              </p>
            )}
          </div>
        );
      })}
      <p className="small muted">
        The model does not use these values; it compares the sound with every baseline. They are shown so you can see
        what the comparison is made against.
      </p>
    </div>
  );
}

// --- CSV export ------------------------------------------------------------------

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Quote, and neutralise spreadsheet formulas in user-entered text.
  const safe = /^[=+\-@\t\r]/.test(s) && typeof value === "string" ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function historyCsv(machine: Machine, entries: HistoryEntry[]): string {
  const header = [
    "machine",
    "recording_id",
    "filename",
    "kind",
    "uploaded_at",
    "recorded_at",
    "operating_context",
    "analysed_at",
    "decision",
    "log_score",
    "threshold",
    "baseline_count",
    "model",
  ];
  const lines = [header.join(",")];
  const ordered = [...entries].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const e of ordered) {
    const context = e.context_readings.map((c) => `${c.name}=${c.value} ${c.unit}`).join("; ");
    const base = [machine.name, e.id, e.original_filename, e.kind, e.created_at, e.recorded_at, context];
    if (e.predictions.length === 0) {
      lines.push([...base, "", "", "", "", "", ""].map(csvCell).join(","));
      continue;
    }
    for (const p of [...e.predictions].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      const model = p.model_versions ? `${p.model_versions.name} ${p.model_versions.version}` : "";
      lines.push(
        [...base, p.created_at, p.decision, p.log_score, p.threshold, p.baseline_count, model].map(csvCell).join(","),
      );
    }
  }
  return lines.join("\r\n") + "\r\n";
}

export function ExportHistoryButton({ machine, entries }: { machine: Machine; entries: HistoryEntry[] }) {
  const download = () => {
    const blob = new Blob([historyCsv(machine, entries)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const slug = machine.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "machine";
    a.href = url;
    a.download = `sonovate-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  return (
    <button type="button" className="button-secondary" onClick={download} disabled={entries.length === 0}>
      Export CSV
    </button>
  );
}
