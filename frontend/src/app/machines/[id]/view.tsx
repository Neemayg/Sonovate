"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { MachineAlertNotice } from "@/components/MachineAlertNotice";
import { MachineForm } from "@/components/MachineForm";
import { JourneySteps } from "@/components/JourneySteps";
import { ConditionCoverage, ExportHistoryButton, analysedPoints } from "@/components/MachineInsights";
import { AlertPanel, MonitoringHeader, SetupModule } from "@/components/MachineStateModules";
import { PageSkeleton, PrototypeNotice } from "@/components/MonitoringStatus";
import { PageHead } from "@/components/PageHead";
import { ResultsComparison } from "@/components/ResultsComparison";
import { RecordingArea } from "@/components/RecordingArea";
import { RecordingWorkbench, type WorkbenchTab } from "@/components/RecordingWorkbench";
import { ErrorMessage, formatDateTime } from "@/components/Status";
import {
  BASELINE_REQUIRED,
  deleteMachine,
  getMachine,
  getMachineAlert,
  listMachineHistory,
  sensitivityLabel,
  updateMachine,
  type HistoryEntry,
  type Machine,
  type MachineAlert,
} from "@/lib/api";
import { MODEL_INPUTS, machineTypeLabel } from "@/lib/modelInputs";
import { monitoringState, recordingNumbers } from "@/lib/monitoring";
import { checkResults } from "@/lib/results";

// Shown once, right after the machine was created (/machines/new adds ?setup=1).
function SetupWelcome({ machine, analysable, baselineCount }: { machine: Machine; analysable: boolean; baselineCount: number }) {
  const baselineDone = baselineCount >= BASELINE_REQUIRED;
  return (
    <section className="card setup-welcome" aria-labelledby="setup-title">
      <p className="eyebrow">Machine registered</p>
      <h2 id="setup-title">{machine.name} is set up.</h2>
      {analysable ? (
        <>
          <p>
            {baselineDone
              ? "Its baseline is complete. Next, run its first acoustic check."
              : `Next, record its normal sound. Upload at least ${BASELINE_REQUIRED} recordings made while it runs as expected; you can add them all at once.`}
          </p>
          <ol className="setup-steps">
            <li className="is-done">Register the machine</li>
            <li className={baselineDone ? "is-done" : "is-current"}>
              <a href="#baseline">Upload normal operating recordings</a>
            </li>
            <li className={baselineDone ? "is-current" : undefined}>
              {baselineDone ? <a href="#check">Run the first acoustic check</a> : "Run the first acoustic check"}
            </li>
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
  const [request, setRequest] = useState<{ tab: WorkbenchTab; n: number } | undefined>(undefined);
  // ?setup=1 marks the first visit after creating the machine (/machines/new).
  // Read once, so removing it from the address below keeps the welcome shown.
  const searchParams = useSearchParams();
  const [justCreated] = useState(() => searchParams.get("setup") === "1");

  // Recordings with their context and stored results; reloaded after every
  // upload or delete so counts always reflect what is stored. The alert is
  // re-read too, since it depends on the stored results.
  const reloadHistory = useCallback(
    () =>
      Promise.all([listMachineHistory(id), getMachineAlert(id)])
        .then(([r, a]) => {
          setRecordings(r);
          setAlert(a);
        })
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

  // #alert links from the dashboard: bring the alert panel into view once it exists.
  useEffect(() => {
    if (recordings && window.location.hash === "#alert") {
      document.getElementById("alert")?.scrollIntoView({ block: "start" });
    }
  }, [recordings]);

  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (machine === undefined || (machine !== null && recordings === null)) return <PageSkeleton label="Loading machine…" />;
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
  const points = analysedPoints(all);
  const checksWithResult = points.length;
  const results = checkResults(all, recordingNumbers(all));
  const state = monitoringState({
    analysable: modelled,
    baselineCount,
    checksWithResult,
    alert: alert?.alert === true,
  });
  const open = (tab: WorkbenchTab) => setRequest((r) => ({ tab, n: (r?.n ?? 0) + 1 }));
  const monitoring = state === "monitoring" || state === "ready_first_check" || state === "alert";

  const workbench = (
    <>
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
        initialTab={justCreated || state === "baseline_incomplete" ? "baseline" : undefined}
        request={request}
        hideBaselineProgress={state === "baseline_incomplete"}
      />
    </>
  );

  return (
    <>
      <PageHead
        crumbs={[{ href: "/machines", label: "Dashboard" }]}
        eyebrow={[machineTypeLabel(machine.machine_type), machine.location].filter(Boolean).join(" · ")}
        title={machine.name}
        meta={`${baselineCount} normal reference${baselineCount === 1 ? "" : "s"} · ${analysisCount} ${analysisCount === 1 ? "check" : "checks"}`}
        actions={
          <>
            <ExportHistoryButton machine={machine} entries={all} />
            <Link href={`/machines/${machine.id}/history`} className="button-like">
              History
            </Link>
          </>
        }
      />
      {modelled && <PrototypeNotice />}

      {modelled && (
        <JourneySteps
          machineId={machine.id}
          baselineCount={baselineCount}
          required={BASELINE_REQUIRED}
          checksWithResult={checksWithResult}
          latestResultId={points[points.length - 1]?.recordingId ?? null}
        />
      )}

      {justCreated && <SetupWelcome machine={machine} analysable={modelled} baselineCount={baselineCount} />}

      {state === "alert" && alert && <AlertPanel alert={alert} entries={all} />}

      {state === "baseline_incomplete" && (
        <SetupModule machine={machine} baselineCount={baselineCount} onAddBaselines={() => open("baseline")} />
      )}

      {monitoring && (
        <MonitoringHeader
          machine={machine}
          state={state}
          baselineCount={baselineCount}
          entries={all}
          onRunCheck={() => open("check")}
        />
      )}

      {modelled && results.length > 0 && (
        <section id="results" className="card" aria-labelledby="results-title">
          <div className="card-header">
            <div>
              <h2 id="results-title">Results</h2>
              <p className="muted small">Every analysed check of {machine.name}, compared with its threshold.</p>
            </div>
            <Link href={`/machines/${machine.id}/history`}>Full history</Link>
          </div>
          <ResultsComparison results={results} />
        </section>
      )}

      {monitoring && state !== "alert" && alert && (
        <section className="card" aria-labelledby="machine-alert-title">
          <h2 id="machine-alert-title">Machine alert</h2>
          <MachineAlertNotice alert={alert} />
        </section>
      )}

      {workbench}

      {modelled && analysisCount > 0 && (
        <details className="card technical-card">
          <summary>Operating-condition coverage</summary>
          <ConditionCoverage machine={machine} entries={all} />
        </details>
      )}

      <section className="card" aria-labelledby="recordings-title">
        <div className="card-header">
          <h2 id="recordings-title">Recordings</h2>
          <Link href={`/machines/${machine.id}/history`}>Full history</Link>
        </div>
        <RecordingArea
          machineType={machine.machine_type}
          entries={all}
          analysable={modelled}
          onChanged={() => void reloadHistory()}
          onAddBaselines={() => open("baseline")}
          onRunCheck={() => open("check")}
        />
      </section>

      <section className="card" aria-labelledby="machine-details-title">
        <div className="card-header">
          <h2 id="machine-details-title">Machine information</h2>
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
            <dt>Sensitivity</dt>
            <dd>{sensitivityLabel(machine.sensitivity)}</dd>
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
