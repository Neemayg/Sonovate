"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BaselineMeter } from "@/components/BaselineMeter";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { ListenCompare } from "@/components/ListenCompare";
import { PageHead } from "@/components/PageHead";
import { EmptyState, PageSkeleton, PrototypeNotice } from "@/components/MonitoringStatus";
import { ContextList, NextStepsCard, TechnicalDetails, VerdictCard, WindowChart } from "@/components/RecordingDetails";
import { ErrorMessage, Loading, formatDateTime } from "@/components/Status";
import { Waveform } from "@/components/Waveform";
import {
  deleteRecording,
  getRecording,
  listPredictions,
  requestAnalysis,
  type AnalysisResult,
  type Prediction,
  type RecordingDetail,
} from "@/lib/api";
import { friendlyAnalysisError } from "@/lib/analysisMessages";
import { machineTypeLabel } from "@/lib/modelInputs";
import { formatDuration, recordingLabel } from "@/lib/monitoring";

export function RecordingAnalysis({ id }: { id: string }) {
  const router = useRouter();
  const [recording, setRecording] = useState<RecordingDetail | null | undefined>(undefined);
  const [predictions, setPredictions] = useState<Prediction[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [confirmRerun, setConfirmRerun] = useState(false);
  // Guards against a second request from a fast double click before React re-renders.
  const runningRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([getRecording(id), listPredictions(id)]);
      setRecording(r);
      setPredictions(p);
      return { recording: r, predictions: p };
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load this recording.");
      return null;
    }
  }, [id]);

  const runAnalysis = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setConfirmRerun(false);
    setRunning(true);
    setResult(null);
    try {
      const outcome = await requestAnalysis(id);
      setResult(outcome);
      if (outcome.status === "completed") await load();
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [id, load]);

  // Effects can run twice (React strict mode); the ref keeps the automatic
  // analysis to one request.
  const autoAnalysed = useRef(false);
  useEffect(() => {
    // Initial fetch. Arriving with ?analyse=1 (e.g. from a seeder or an older
    // link), the analysis then runs once and the flag is dropped, so a reload
    // does not run it again. The machine page's check uploader analyses by itself.
    const autoAnalyse =
      !autoAnalysed.current && new URLSearchParams(window.location.search).get("analyse") === "1";
    if (autoAnalyse) autoAnalysed.current = true;
    if (autoAnalyse) router.replace(`/recordings/${id}`, { scroll: false });
    // State is set after the requests resolve, as before this change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().then((loaded) => {
      if (autoAnalyse && loaded?.recording?.kind === "analysis" && loaded.predictions.length === 0) {
        void runAnalysis();
      }
    });
  }, [id, load, router, runAnalysis]);

  // #listen links (dashboard alert, machine page): scroll once the section exists.
  useEffect(() => {
    if (recording && window.location.hash === "#listen") {
      document.getElementById("listen")?.scrollIntoView({ block: "start" });
    }
  }, [recording]);

  if (loadError) return <ErrorMessage>{loadError}</ErrorMessage>;
  if (recording === undefined) return <PageSkeleton label="Loading recording…" />;
  if (recording === null) {
    return (
      <>
        <ErrorMessage>Recording not found. It may have been removed, or it belongs to another account.</ErrorMessage>
        <p>
          <Link href="/machines">Back to machines</Link>
        </p>
      </>
    );
  }

  const machine = recording.machines;
  const isCheck = recording.kind === "analysis";
  const latest = predictions && predictions.length > 0 ? predictions[0] : null;
  const earlier = predictions ? predictions.slice(1) : [];
  const title = recordingLabel(recording);

  const statusNotices = (
    <>
      {running && <Loading label="Comparing against the machine baseline…" />}

      {result?.status === "no_validated_model" && (
        <div className="notice notice-info" role="status">
          <p>
            <strong>No validated model yet.</strong>
          </p>
          <p>{result.message}</p>
        </div>
      )}

      {result?.status === "unsupported_machine_type" && (
        <div className="notice notice-info" role="status">
          <p>
            <strong>Not supported for this machine type.</strong>
          </p>
          <p>{result.message}</p>
        </div>
      )}

      {result?.status === "baseline_required" && (
        <div className="notice notice-info" role="status">
          <p>
            <strong>
              Baseline needed: {result.count}/{result.required} baseline recordings.
            </strong>
          </p>
          <p>
            Results are compared with this machine&apos;s own normal recordings. Upload{" "}
            {result.required - result.count} more baseline{" "}
            {result.required - result.count === 1 ? "recording" : "recordings"}, made while it runs normally. Nothing
            was stored.
          </p>
          {machine && (
            <p>
              <Link href={`/machines/${machine.id}#baseline`}>Upload baseline recordings</Link>
            </p>
          )}
          <BaselineMeter count={result.count} required={result.required} />
        </div>
      )}

      {result?.status === "baseline_recording" && (
        <div className="notice notice-info" role="status">
          {result.message}
        </div>
      )}

      {result?.status === "error" && (
        <ErrorMessage>
          <p>
            <strong>{friendlyAnalysisError(result.code, result.message).title}</strong>
          </p>
          <p>
            {friendlyAnalysisError(result.code, result.message).message}
            {result.code === "unauthenticated" && (
              <>
                {" "}
                <Link href="/login">Sign in</Link>
              </>
            )}
          </p>
        </ErrorMessage>
      )}

      {result?.status === "completed" && (
        <div className="notice" role="status">
          Analysis saved.
        </div>
      )}
    </>
  );

  const runControls = latest ? (
    confirmRerun ? (
      <div className="notice rerun-confirm" role="group" aria-label="Confirm re-run">
        <p>
          Re-running adds <strong>another analysis result</strong> for this recording. The{" "}
          {predictions!.length === 1 ? "existing result is" : `${predictions!.length} existing results are`} kept.
        </p>
        <div className="actions">
          <button type="button" onClick={runAnalysis} disabled={running}>
            Re-run analysis
          </button>
          <button type="button" className="button-secondary" onClick={() => setConfirmRerun(false)}>
            Cancel
          </button>
        </div>
      </div>
    ) : (
      <div className="actions">
        <button type="button" className="button-secondary" onClick={() => setConfirmRerun(true)} disabled={running}>
          {running ? "Analysing…" : "Re-run analysis"}
        </button>
        <span className="muted small">Creates another analysis result; earlier results are kept.</span>
      </div>
    )
  ) : (
    <div className="actions">
      <button type="button" onClick={runAnalysis} disabled={running}>
        {running ? "Analysing…" : "Run analysis"}
      </button>
    </div>
  );

  return (
    <>
      <PageHead
        crumbs={[
          { href: "/machines", label: "Machines" },
          ...(machine ? [{ href: `/machines/${machine.id}`, label: machine.name }] : []),
        ]}
        eyebrow={isCheck ? "Machine check" : "Normal reference recording"}
        title={title}
        meta={recording.original_filename ? `File: ${recording.original_filename}` : undefined}
      />
      {isCheck && <PrototypeNotice />}

      {isCheck && latest && <VerdictCard p={latest} />}

      {isCheck && !latest && (
        <section className="card" aria-labelledby="analysis-title" aria-busy={running}>
          <h2 id="analysis-title">Analysis</h2>
          {!result && !running && (
            <EmptyState title="Not analysed yet">Run the analysis to compare this recording with the machine&apos;s baseline.</EmptyState>
          )}
          {statusNotices}
          {runControls}
        </section>
      )}

      {isCheck && machine && (
        <section id="listen" className="card listen-card" aria-labelledby="listen-title">
          <div className="card-header">
            <div>
              <h2 id="listen-title">Listen &amp; compare</h2>
              <p className="muted small">Hear this check next to a normal reference from the same machine.</p>
            </div>
          </div>
          <ListenCompare machineId={machine.id} machineType={machine.machine_type} recording={recording} />
        </section>
      )}

      <div className="columns result-columns">
        <section className="card" aria-labelledby="overview-title">
          <h2 id="overview-title">Recording overview</h2>
          <Waveform storagePath={recording.storage_path} label={title} />
          <dl className="details">
            <dt>Recorded</dt>
            <dd>{formatDateTime(recording.recorded_at ?? recording.created_at)}</dd>
            <dt>Duration</dt>
            <dd className="num">{formatDuration(recording.duration_seconds)}</dd>
            <dt>Machine</dt>
            <dd>
              {machine ? (
                <Link href={`/machines/${machine.id}`}>
                  {machine.name} ({machineTypeLabel(machine.machine_type)})
                </Link>
              ) : (
                "—"
              )}
            </dd>
            {isCheck && (
              <>
                <dt>Baseline used</dt>
                <dd>{latest?.baseline_count ? `${latest.baseline_count} normal recordings` : "—"}</dd>
                <dt>Analysis status</dt>
                <dd>
                  {latest
                    ? `Analysed ${formatDateTime(latest.created_at)}${earlier.length > 0 ? ` · ${predictions!.length} results` : ""}`
                    : running
                      ? "Analysing…"
                      : "Not analysed yet"}
                </dd>
              </>
            )}
            {!isCheck && (
              <>
                <dt>Role</dt>
                <dd>Normal reference: sets this machine&apos;s threshold and is never analysed itself.</dd>
              </>
            )}
          </dl>
        </section>

        <section className="card" aria-labelledby="context-title">
          <h2 id="context-title">Operating conditions</h2>
          {recording.context_readings.length === 0 ? (
            <EmptyState title="None entered">Operating conditions are optional and are not used by the model.</EmptyState>
          ) : (
            <>
              <ContextList readings={recording.context_readings} machineType={machine?.machine_type ?? "other"} />
              <p className="muted small">Entered when uploading; stored for your records, not used by the model.</p>
            </>
          )}
          {!isCheck && machine && (
            <p className="small">
              <Link href={`/machines/${machine.id}#baseline`}>See baseline progress for {machine.name}</Link>
            </p>
          )}
        </section>
      </div>

      {isCheck && latest && <WindowChart p={latest} />}
      {isCheck && latest && <NextStepsCard p={latest} />}

      {isCheck && latest && (
        <>
          <TechnicalDetails p={latest} earlier={earlier} />
          <section className="card rerun-card" aria-labelledby="rerun-title" aria-busy={running}>
            <h2 id="rerun-title" className="visually-hidden">
              Run the analysis again
            </h2>
            {statusNotices}
            {runControls}
          </section>
        </>
      )}

      <details className="card technical-card">
        <summary>Recording file details</summary>
        <dl className="details">
          <dt>Original file</dt>
          <dd>{recording.original_filename ?? "—"}</dd>
          <dt>Uploaded</dt>
          <dd>{formatDateTime(recording.created_at)}</dd>
          <dt>Format</dt>
          <dd className="num">
            {recording.duration_seconds && recording.sample_rate_hz
              ? `${recording.duration_seconds.toFixed(2)} s · ${recording.sample_rate_hz / 1000} kHz · ${
                  recording.channels === 1 ? "mono" : `${recording.channels} channels`
                }`
              : "—"}
          </dd>
        </dl>
      </details>

      <section className="card danger-zone" aria-labelledby="delete-recording-title">
        <h2 id="delete-recording-title">Danger zone</h2>
        <ConfirmDelete
          label="Delete recording"
          onConfirm={async () => {
            await deleteRecording(recording);
            router.replace(machine ? `/machines/${machine.id}` : "/machines");
          }}
        >
          <p>
            This removes the audio file
            {predictions && predictions.length > 0
              ? ", its operating context and its analysis results."
              : " and its operating context."}
          </p>
          {recording.kind === "baseline" && (
            <p>
              It is a baseline recording, so this machine&apos;s threshold will be recomputed at the next analysis. With
              fewer than 10 baseline recordings, no results are shown.
            </p>
          )}
        </ConfirmDelete>
      </section>
    </>
  );
}
