"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { MachineAlertNotice } from "@/components/MachineAlertNotice";
import { MachineForm } from "@/components/MachineForm";
import { ConditionCoverage, ExportHistoryButton, ResultTimeline } from "@/components/MachineInsights";
import { PageHead } from "@/components/PageHead";
import { RecordingWorkbench } from "@/components/RecordingWorkbench";
import { Empty, ErrorMessage, Loading, formatDateTime } from "@/components/Status";
import {
  BASELINE_REQUIRED,
  deleteMachine,
  getMachine,
  getMachineAlert,
  listMachineHistory,
  updateMachine,
  type HistoryEntry,
  type Machine,
  type MachineAlert,
} from "@/lib/api";
import { MODEL_INPUTS, machineTypeLabel } from "@/lib/modelInputs";

const RECORDINGS_SHOWN = 12;

// Shown once, right after the machine was created (/machines/new adds ?setup=1).
function SetupWelcome({ machine, analysable }: { machine: Machine; analysable: boolean }) {
  return (
    <section className="card setup-welcome" aria-labelledby="setup-title">
      <p className="eyebrow">Machine registered</p>
      <h2 id="setup-title">{machine.name} is set up.</h2>
      {analysable ? (
        <>
          <p>
            Next, record its normal sound. Upload at least {BASELINE_REQUIRED} recordings made while it runs as
            expected; you can add them all at once.
          </p>
          <ol className="setup-steps">
            <li className="is-done">Register the machine</li>
            <li className="is-current">
              <a href="#baseline">Upload normal operating recordings</a>
            </li>
            <li>Run the first acoustic check</li>
          </ol>
        </>
      ) : (
        <p>
          This category is stored for record keeping; acoustic analysis is not available for it. You can still keep
          recordings and notes here.
        </p>
      )}
    </section>
  );
}

export function MachineDetail({ id }: { id: string }) {
  const router = useRouter();
  const [machine, setMachine] = useState<Machine | null | undefined>(undefined);
  const [recordings, setRecordings] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [alert, setAlert] = useState<MachineAlert | null>(null);
  // ?setup=1 marks the first visit after creating the machine (/machines/new).
  // Read once, so removing it from the address below keeps the welcome shown.
  const searchParams = useSearchParams();
  const [justCreated] = useState(() => searchParams.get("setup") === "1");
  const [listFilter, setListFilter] = useState<"all" | "baseline" | "analysis">("all");
  const [showAll, setShowAll] = useState(false);

  // Recordings with their context and stored results, which the timeline,
  // coverage panels and baseline count read; reloaded after every upload so
  // the count always reflects what is stored.
  const reloadHistory = useCallback(
    () =>
      listMachineHistory(id)
        .then(setRecordings)
        .catch((err: Error) => setError(err.message)),
    [id],
  );

  useEffect(() => {
    Promise.all([getMachine(id), listMachineHistory(id), getMachineAlert(id)])
      .then(([m, r, a]) => {
        setMachine(m);
        setRecordings(r);
        setAlert(a);
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  // Remove ?setup=1 from the address so a reload or a shared link does not
  // show the welcome again.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("setup") === "1") {
      params.delete("setup");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  }, []);

  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (machine === undefined || (machine !== null && recordings === null)) return <Loading label="Loading machine…" />;
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

  const all = recordings ?? [];
  const modelled = MODEL_INPUTS[machine.machine_type].length > 0;
  const baselineCount = all.filter((r) => r.kind === "baseline").length;
  const analysisCount = all.length - baselineCount;
  const listed = all.filter((r) => listFilter === "all" || r.kind === listFilter);
  const visible = showAll ? listed : listed.slice(0, RECORDINGS_SHOWN);

  return (
    <>
      <PageHead
        crumbs={[{ href: "/machines", label: "Machines" }]}
        eyebrow={[machineTypeLabel(machine.machine_type), machine.location].filter(Boolean).join(" · ")}
        title={machine.name}
        meta={`${baselineCount} baseline · ${analysisCount} ${analysisCount === 1 ? "check" : "checks"}`}
        actions={
          <>
            <ExportHistoryButton machine={machine} entries={all} />
            <Link href={`/machines/${machine.id}/history`} className="button-like">
              History
            </Link>
          </>
        }
      />

      {justCreated && <SetupWelcome machine={machine} analysable={modelled} />}

      {alert && (
        <section className="card" aria-labelledby="machine-alert-title">
          <h2 id="machine-alert-title">Machine alert</h2>
          <MachineAlertNotice alert={alert} />
        </section>
      )}

      {/* Anchor targets for links from the dashboard and the setup steps. */}
      <span id="baseline" className="anchor" aria-hidden="true" />
      <span id="check" className="anchor" aria-hidden="true" />
      <RecordingWorkbench
        machineId={machine.id}
        machineName={machine.name}
        machineType={machine.machine_type}
        analysable={modelled}
        baselineCount={baselineCount}
        reload={reloadHistory}
        initialTab={justCreated ? "baseline" : undefined}
      />

      {modelled && analysisCount > 0 && (
        <div className="insights">
          <section className="card" aria-labelledby="timeline-title">
            <div className="card-header">
              <h2 id="timeline-title">Result timeline</h2>
              <span className="muted small">Oldest → newest</span>
            </div>
            <ResultTimeline entries={all} />
          </section>
          <section className="card" aria-labelledby="coverage-title">
            <div className="card-header">
              <h2 id="coverage-title">Operating-condition coverage</h2>
            </div>
            <ConditionCoverage machine={machine} entries={all} />
          </section>
        </div>
      )}

      <section className="card" aria-labelledby="recordings-title">
        <div className="card-header">
          <h2 id="recordings-title">Recordings</h2>
          <Link href={`/machines/${machine.id}/history`}>View history</Link>
        </div>
        {all.length === 0 ? (
          <Empty>No recordings yet. {modelled ? "Start with the baseline recordings above." : ""}</Empty>
        ) : (
          <>
            <div className="filters" role="group" aria-label="Filter recordings">
              {(
                [
                  ["all", "All", all.length],
                  ["baseline", "Baseline", baselineCount],
                  ["analysis", "Checks", analysisCount],
                ] as const
              ).map(([value, label, count]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={listFilter === value}
                  onClick={() => {
                    setListFilter(value);
                    setShowAll(false);
                  }}
                >
                  {label} <span className="num">{count}</span>
                </button>
              ))}
            </div>
            {listed.length === 0 ? (
              <Empty>No recordings of this kind yet.</Empty>
            ) : (
              <ul className="list">
                {visible.map((r) => (
                  <li key={r.id}>
                    <Link href={`/recordings/${r.id}`} className="list-link">
                      <span className="list-title">{r.original_filename ?? "Recording"}</span>
                      <span className="muted small">
                        <span className={`tag tag-${r.kind}`}>{r.kind === "baseline" ? "Baseline" : "Check"}</span>{" "}
                        uploaded {formatDateTime(r.created_at)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {listed.length > RECORDINGS_SHOWN && (
              <button type="button" className="button-link" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `Show all ${listed.length}`}
              </button>
            )}
          </>
        )}
      </section>

      <section className="card" aria-labelledby="machine-details-title">
        <div className="card-header">
          <h2 id="machine-details-title">Details</h2>
          {!editing && (
            <button type="button" className="button-secondary" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
        {editing ? (
          <MachineForm
            initial={machine}
            submitLabel="Save changes"
            onCancel={() => setEditing(false)}
            onSubmit={async (input) => {
              setMachine(await updateMachine(machine.id, input));
              setEditing(false);
            }}
          />
        ) : (
          <dl className="details">
            <dt>Type</dt>
            <dd>{machineTypeLabel(machine.machine_type)}</dd>
            <dt>Location</dt>
            <dd>{machine.location ?? "—"}</dd>
            <dt>Notes</dt>
            <dd>{machine.notes ?? "—"}</dd>
            <dt>Last updated</dt>
            <dd>{formatDateTime(machine.updated_at)}</dd>
          </dl>
        )}
      </section>

      <section className="card danger-zone" aria-labelledby="delete-machine-title">
        <h2 id="delete-machine-title">Danger zone</h2>
        <ConfirmDelete
          label="Delete machine"
          confirmText={machine.name}
          onConfirm={async () => {
            await deleteMachine(machine.id);
            router.replace("/machines");
          }}
        >
          <p>
            This deletes {machine.name} and everything under it: {all.length}{" "}
            {all.length === 1 ? "recording" : "recordings"} with their audio files, operating context, analysis results
            and baseline threshold.
          </p>
        </ConfirmDelete>
      </section>
    </>
  );
}
