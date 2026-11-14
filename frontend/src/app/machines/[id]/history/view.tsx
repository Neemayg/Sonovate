"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ExportHistoryButton } from "@/components/MachineInsights";
import { EmptyState, PageSkeleton, PrototypeNotice } from "@/components/MonitoringStatus";
import { PageHead } from "@/components/PageHead";
import { conditionsText } from "@/components/RecordingArea";
import { SCORE_NOTE, isAbove, windowScores } from "@/components/RecordingDetails";
import { ErrorMessage, formatDateTime } from "@/components/Status";
import { getMachine, listMachineHistory, type HistoryEntry, type Machine, type Prediction } from "@/lib/api";
import { machineTypeLabel } from "@/lib/modelInputs";
import { formatDuration, recordingNumbers, recordingShortLabel } from "@/lib/monitoring";

// A compact table, newest first by default. One row per recording with its
// latest stored result; expanding a row shows the stored figures. No chart or
// trend line is drawn: a line through uncalibrated scores would suggest a
// trend the evidence does not support.

type KindFilter = "all" | "baseline" | "analysis";
type ResultFilter = "all" | "above" | "below" | "none";

function when(e: HistoryEntry): string {
  return e.recorded_at ?? e.created_at;
}

function latestOf(e: HistoryEntry): Prediction | null {
  if (e.predictions.length === 0) return null;
  return e.predictions.reduce((a, b) => (b.created_at > a.created_at ? b : a));
}

export function MachineHistory({ id }: { id: string }) {
  const [machine, setMachine] = useState<Machine | null | undefined>(undefined);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [res, setRes] = useState<ResultFilter>("all");
  const [newestFirst, setNewestFirst] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([getMachine(id), listMachineHistory(id)])
      .then(([m, h]) => {
        setMachine(m);
        setEntries(h);
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  const numbers = useMemo(() => recordingNumbers(entries ?? []), [entries]);

  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (machine === undefined || entries === null) return <PageSkeleton label="Loading history…" />;
  if (machine === null) {
    return (
      <>
        <ErrorMessage>Machine not found. It may have been removed, or it belongs to another account.</ErrorMessage>
        <p>
          <Link href="/machines">Back to machines</Link>
        </p>
      </>
    );
  }

  const analysed = entries.filter((e) => e.predictions.length > 0).length;
  const baselines = entries.filter((e) => e.kind === "baseline").length;

  const rows = entries
    .filter((e) => kind === "all" || e.kind === kind)
    .filter((e) => {
      if (res === "all") return true;
      const p = latestOf(e);
      if (res === "none") return e.kind === "analysis" && !p;
      return p !== null && (res === "above" ? isAbove(p) : !isAbove(p));
    })
    .sort((a, b) => (newestFirst ? when(b).localeCompare(when(a)) : when(a).localeCompare(when(b))));

  const toggle = (rid: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });

  return (
    <>
      <PageHead
        crumbs={[
          { href: "/machines", label: "Machines" },
          { href: `/machines/${machine.id}`, label: machine.name },
        ]}
        eyebrow={`${machineTypeLabel(machine.machine_type)} · history`}
        title={machine.name}
        meta={`${entries.length} ${entries.length === 1 ? "recording" : "recordings"} · ${baselines} normal references · ${analysed} analysed`}
        actions={<ExportHistoryButton machine={machine} entries={entries} />}
      />
      <PrototypeNotice />

      <section className="card" aria-labelledby="history-title">
        <div className="card-header">
          <h2 id="history-title">Recordings over time</h2>
          <span className="muted small" role="status">
            {rows.length} of {entries.length} shown
          </span>
        </div>

        {entries.length === 0 ? (
          <EmptyState
            title="No recordings yet"
            action={
              <Link href={`/machines/${machine.id}#baseline`} className="btn btn-primary btn-sm">
                Add baseline recordings
              </Link>
            }
          >
            Add normal baseline recordings to get started.
          </EmptyState>
        ) : (
          <>
            <div className="hist-toolbar">
              <div className="filters" role="group" aria-label="Recording type">
                {(
                  [
                    ["all", "All"],
                    ["baseline", "Baselines"],
                    ["analysis", "Checks"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={kind === v} onClick={() => setKind(v)}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="filters" role="group" aria-label="Result">
                {(
                  [
                    ["all", "Any result"],
                    ["above", "Above threshold"],
                    ["below", "Within threshold"],
                    ["none", "Not analysed"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={res === v} onClick={() => setRes(v)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {rows.length === 0 ? (
              <EmptyState title="Nothing matches these filters">Change the filters to see more recordings.</EmptyState>
            ) : (
              <div className="hist-wrap">
                <table className="hist-table">
                  <thead>
                    <tr>
                      <th scope="col" aria-sort={newestFirst ? "descending" : "ascending"}>
                        <button type="button" className="hist-sort" onClick={() => setNewestFirst((v) => !v)}>
                          Date and time <span aria-hidden="true">{newestFirst ? "↓" : "↑"}</span>
                          <span className="visually-hidden">, sorted {newestFirst ? "newest first" : "oldest first"}</span>
                        </button>
                      </th>
                      <th scope="col">Type</th>
                      <th scope="col">Result</th>
                      <th scope="col">Duration</th>
                      <th scope="col">Baseline count</th>
                      <th scope="col">Operating conditions</th>
                      <th scope="col">
                        <span className="visually-hidden">Details</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e) => {
                      const p = latestOf(e);
                      const expanded = open.has(e.id);
                      const detailsId = `hist-${e.id}`;
                      const conditions = conditionsText(e, machine.machine_type);
                      return (
                        <Fragment key={e.id}>
                          <tr className={`hist-row${expanded ? " is-open" : ""}`}>
                            <td data-label="Date">
                              <Link href={`/recordings/${e.id}`} className="hist-name">
                                {recordingShortLabel(e, numbers.get(e.id))}
                              </Link>
                              <span className="muted small num">{formatDateTime(when(e))}</span>
                            </td>
                            <td data-label="Type">
                              <span className={`tag tag-${e.kind}`}>{e.kind === "baseline" ? "Normal reference" : "Check"}</span>
                            </td>
                            <td data-label="Result">
                              {e.kind === "baseline" ? (
                                <span className="muted small">Sets the threshold</span>
                              ) : p ? (
                                <span className={`decision-pill${isAbove(p) ? " is-above" : ""}`}>
                                  {isAbove(p) ? "Above threshold" : "Within threshold"}
                                </span>
                              ) : (
                                <span className="decision-pill is-pending">Not analysed</span>
                              )}
                            </td>
                            <td data-label="Duration" className="num">
                              {formatDuration(e.duration_seconds)}
                            </td>
                            <td data-label="Baselines" className="num">
                              {p?.baseline_count ?? "—"}
                            </td>
                            <td data-label="Conditions" className="small">
                              {conditions || <span className="muted">None entered</span>}
                            </td>
                            <td className="hist-actions">
                              <button
                                type="button"
                                className="button-secondary btn-sm"
                                aria-expanded={expanded}
                                aria-controls={detailsId}
                                onClick={() => toggle(e.id)}
                              >
                                {expanded ? "Hide" : "Details"}
                              </button>
                            </td>
                          </tr>
                          {expanded && (
                            <tr id={detailsId} className="hist-detail">
                              <td colSpan={7}>
                                <dl className="details">
                                  <dt>Original file</dt>
                                  <dd>{e.original_filename ?? "—"}</dd>
                                  <dt>Uploaded</dt>
                                  <dd>{formatDateTime(e.created_at)}</dd>
                                  {p && (
                                    <>
                                      <dt>Analysed</dt>
                                      <dd>{formatDateTime(p.created_at)}</dd>
                                      <dt>Log score / threshold</dt>
                                      <dd className="num">
                                        {p.log_score !== null ? p.log_score.toFixed(3) : "—"} / {p.threshold.toFixed(3)}
                                      </dd>
                                      {windowScores(p).length > 1 && (
                                        <>
                                          <dt>Window log scores</dt>
                                          <dd className="num">{windowScores(p).map((v) => v.toFixed(2)).join(" · ")}</dd>
                                        </>
                                      )}
                                      <dt>Sensitivity</dt>
                                      <dd>{p.sensitivity === "high" ? "High" : "Standard"}</dd>
                                      <dt>Model</dt>
                                      <dd>{p.model_versions ? `${p.model_versions.name} ${p.model_versions.version}` : "—"}</dd>
                                      {e.predictions.length > 1 && (
                                        <>
                                          <dt>Results stored</dt>
                                          <dd>{e.predictions.length} (latest shown)</dd>
                                        </>
                                      )}
                                    </>
                                  )}
                                </dl>
                                <Link href={`/recordings/${e.id}`} className="button-like btn-sm">
                                  {e.kind === "analysis" ? "Open result" : "Open recording"}
                                </Link>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {analysed > 0 && <p className="muted small">{SCORE_NOTE}</p>}
      </section>
    </>
  );
}
