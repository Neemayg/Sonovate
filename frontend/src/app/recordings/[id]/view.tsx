"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BaselineMeter } from "@/components/BaselineMeter";
import { ConfirmDelete } from "@/components/ConfirmDelete";
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
import { machineTypeLabel } from "@/lib/modelInputs";

export function RecordingAnalysis({ id }: { id: string }) {
  const router = useRouter();
  const [recording, setRecording] = useState<RecordingDetail | null | undefined>(undefined);
  const [predictions, setPredictions] = useState<Prediction[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([getRecording(id), listPredictions(id)]);
      setRecording(r);
      setPredictions(p);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load this recording.");
    }
  }, [id]);

  useEffect(() => {
    // Initial fetch of external data; state is set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function runAnalysis() {
    setRunning(true);
    setResult(null);
    const outcome = await requestAnalysis(id);
    setResult(outcome);
    setRunning(false);
    if (outcome.status === "completed") await load();
  }

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
        eyebrow={recording.kind === "baseline" ? "Baseline recording" : "Analysis recording"}
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
              <dd>{recording.kind === "baseline" ? "Baseline (known normal operation)" : "Analysis"}</dd>
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
                    <Link href={`/machines/${machine.id}`}>Upload baseline recordings</Link>
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
                {result.message}
                {result.code === "unauthenticated" && (
                  <>
                    {" "}
                    <Link href="/login">Sign in</Link>
                  </>
                )}
              </ErrorMessage>
            )}

            {result?.status === "completed" && (
              <div className="notice" role="status">
                Analysis saved.
              </div>
            )}

            <div className="actions">
              <button type="button" onClick={runAnalysis} disabled={running}>
                {running ? "Analysing…" : "Run analysis"}
              </button>
            </div>
          </section>
        )}
      </div>

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
