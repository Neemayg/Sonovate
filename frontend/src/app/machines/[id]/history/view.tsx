"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHead } from "@/components/PageHead";
import { ContextList, PredictionView, SCORE_NOTE } from "@/components/RecordingDetails";
import { Empty, ErrorMessage, Loading, formatDateTime } from "@/components/Status";
import { getMachine, listMachineHistory, type HistoryEntry, type Machine } from "@/lib/api";
import { machineTypeLabel } from "@/lib/modelInputs";

// A plain list, newest first. No chart or trend line is drawn: there are no
// validated results, and a line through a few uncalibrated scores would
// suggest a trend that the evidence does not support.
export function MachineHistory({ id }: { id: string }) {
  const [machine, setMachine] = useState<Machine | null | undefined>(undefined);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getMachine(id), listMachineHistory(id)])
      .then(([m, h]) => {
        setMachine(m);
        setEntries(h);
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (machine === undefined || entries === null) return <Loading label="Loading history…" />;
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

  return (
    <>
      <PageHead
        crumbs={[
          { href: "/machines", label: "Machines" },
          { href: `/machines/${machine.id}`, label: machine.name },
        ]}
        eyebrow={`${machineTypeLabel(machine.machine_type)} · history`}
        title={machine.name}
        meta={`${entries.length} ${entries.length === 1 ? "recording" : "recordings"} · ${baselines} baseline · ${analysed} analysed`}
      />

      <section className="card" aria-labelledby="history-title">
        <h2 id="history-title">Recordings over time</h2>
        {entries.length === 0 ? (
          <Empty>
            No recordings for this machine yet. <Link href={`/machines/${machine.id}`}>Upload one</Link>.
          </Empty>
        ) : (
          <ol className="timeline">
            {entries.map((e) => (
              <li key={e.id} className={e.kind === "baseline" ? "is-baseline" : undefined}>
                <h3>
                  <Link href={`/recordings/${e.id}`} className="num">
                    {formatDateTime(e.recorded_at ?? e.created_at)}
                  </Link>{" "}
                  <span className={`tag tag-${e.kind}`}>{e.kind === "baseline" ? "Baseline" : "Analysis"}</span>
                </h3>
                <p className="muted small">
                  {e.original_filename ?? "Recording"}
                  {e.recorded_at ? ` · uploaded ${formatDateTime(e.created_at)}` : " · recording time not entered"}
                </p>
                <h4 className="eyebrow">Operating context</h4>
                {e.context_readings.length === 0 ? (
                  <p className="empty small">None entered.</p>
                ) : (
                  <ContextList readings={e.context_readings} machineType={machine.machine_type} />
                )}
                <h4 className="eyebrow">Analysis</h4>
                {e.kind === "baseline" ? (
                  <p className="empty small">Baseline recording: used to set this machine&apos;s threshold.</p>
                ) : e.predictions.length === 0 ? (
                  <p className="empty small">Not analysed.</p>
                ) : (
                  e.predictions.map((p) => <PredictionView key={p.id} p={p} />)
                )}
              </li>
            ))}
          </ol>
        )}
        {analysed > 0 && <p className="muted small">{SCORE_NOTE}</p>}
      </section>
    </>
  );
}
