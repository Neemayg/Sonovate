"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BaselineMeter } from "@/components/BaselineMeter";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { ListenCompare } from "@/components/ListenCompare";
import { PageHead } from "@/components/PageHead";
import { ContextList, PredictionView, SCORE_NOTE } from "@/components/RecordingDetails";
import { Empty, ErrorMessage, Loading, formatDateTime } from "@/components/Status";
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

  if (loadError) return <ErrorMessage>{loadError}</ErrorMessage>;
  if (recording === undefined) return <Loading label="Loading recording…" />;
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

  return (
    <>
      <PageHead
        crumbs={[
          { href: "/machines", label: "Machines" },
          ...(machine ? [{ href: `/machines/${machine.id}`, label: machine.name }] : []),
        ]}
        eyebrow={recording.kind === "baseline" ? "Baseline recording" : "Machine check"}
        title={recording.original_filename ?? "Recording"}
        meta={`Uploaded ${formatDateTime(recording.created_at)}`}
      />

      <div className="columns">
        <div>
          <section className="card" aria-labelledby="recording-title">
            <h2 id="recording-title">Recording</h2>
            <Waveform storagePath={recording.storage_path} label={recording.original_filename ?? "this recording"} />
            <dl className="details">
              <dt>Machine</dt>
              <dd>{machine ? `${machine.name} (${machineTypeLabel(machine.machine_type)})` : "—"}</dd>
              <dt>File</dt>
              <dd>{recording.original_filename ?? "—"}</dd>
              <dt>Purpose</dt>
              <dd>{recording.kind === "baseline" ? "Baseline (known normal operation)" : "Machine check"}</dd>
              <dt>Recorded at</dt>
              <dd>{formatDateTime(recording.recorded_at)}</dd>
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
          </section>

          <section className="card" aria-labelledby="context-title">
            <h2 id="context-title">Operating context</h2>
            {recording.context_readings.length === 0 ? (
              <Empty>No operating context was entered for this recording.</Empty>
            ) : (
              <>
                <ContextList readings={recording.context_readings} machineType={machine?.machine_type ?? "other"} />
                <p className="muted small">Entered by you when uploading.</p>
              </>
            )}
          </section>
        </div>

        {recording.kind === "baseline" ? (
          <section className="card" aria-labelledby="analysis-title">
            <h2 id="analysis-title">Baseline recording</h2>
            <p>
              This recording is part of this machine&apos;s baseline: it is used to set the machine&apos;s threshold and
              is not analysed itself.
            </p>
            {machine && (
              <p>
                <Link href={`/machines/${machine.id}`}>See baseline progress for {machine.name}</Link>
              </p>
            )}
          </section>
        ) : (
          <section className="card" aria-labelledby="analysis-title" aria-busy={running}>
            <h2 id="analysis-title">Analysis result</h2>

            {predictions && predictions.length > 0 ? (
              <>
                {predictions.map((p) => (
                  <PredictionView key={p.id} p={p} />
                ))}
                <p className="muted small">{SCORE_NOTE}</p>
              </>
            ) : (
              !result && <Empty>This recording has not been analysed yet.</Empty>
            )}

            {running && <Loading label="Analysing recording…" />}

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
                  {result.required - result.count === 1 ? "recording" : "recordings"}, made while it runs normally.
                  Nothing was stored.
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

            {predictions && predictions.length > 0 ? (
              confirmRerun ? (
                <div className="notice rerun-confirm" role="group" aria-label="Confirm re-run">
                  <p>
                    Re-running adds <strong>another analysis result</strong> for this recording. The{" "}
                    {predictions.length === 1 ? "existing result is" : `${predictions.length} existing results are`} kept.
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
            )}
          </section>
        )}
      </div>

      {recording.kind === "analysis" && machine && (
        <section className="card" aria-labelledby="listen-title">
          <div className="card-header">
            <h2 id="listen-title">Listen &amp; compare</h2>
            <span className="muted small">Hear it next to this machine&apos;s normal sound</span>
          </div>
          <ListenCompare machineId={machine.id} machineType={machine.machine_type} recording={recording} />
        </section>
      )}

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
