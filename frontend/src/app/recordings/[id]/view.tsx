"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Empty, ErrorMessage, Loading, formatDateTime } from "@/components/Status";
import {
  getRecording,
  listPredictions,
  requestAnalysis,
  type AnalysisResult,
  type Prediction,
  type RecordingDetail,
} from "@/lib/api";

const SCORE_NOTE =
  "Anomaly scores are uncalibrated: they are not a failure probability, a health percentage or a diagnosis.";

function decisionLabel(decision: string): string {
  return decision === "above_threshold"
    ? "Above the model's threshold (less typical than its reference data)"
    : "Below the model's threshold (similar to its reference data)";
}

function PredictionView({ p }: { p: Prediction }) {
  return (
    <dl className="details">
      <dt>Result</dt>
      <dd>{decisionLabel(p.decision)}</dd>
      <dt>Anomaly score</dt>
      <dd>
        {p.score.toPrecision(4)} <span className="muted">(threshold {p.threshold.toPrecision(4)})</span>
      </dd>
      <dt>Model</dt>
      <dd>
        {p.model_versions
          ? `${p.model_versions.name} ${p.model_versions.version} (preprocessing ${p.model_versions.preprocessing_version})`
          : "Unknown model version"}
      </dd>
      <dt>Analysed</dt>
      <dd>{formatDateTime(p.created_at)}</dd>
    </dl>
  );
}

export function RecordingAnalysis({ id }: { id: string }) {
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
      <p className="breadcrumb">
        <Link href="/machines">Machines</Link>
        {machine && (
          <>
            {" / "}
            <Link href={`/machines/${machine.id}`}>{machine.name}</Link>
          </>
        )}
        {" / Recording"}
      </p>
      <h1>Analysis</h1>

      <section className="card" aria-labelledby="recording-title">
        <h2 id="recording-title">Recording</h2>
        <dl className="details">
          <dt>Machine</dt>
          <dd>{machine?.name ?? "—"}</dd>
          <dt>File</dt>
          <dd>{recording.original_filename ?? "—"}</dd>
          <dt>Purpose</dt>
          <dd>{recording.kind === "baseline" ? "Baseline (known normal operation)" : "Analysis"}</dd>
          <dt>Recorded at</dt>
          <dd>{formatDateTime(recording.recorded_at)}</dd>
          <dt>Uploaded</dt>
          <dd>{formatDateTime(recording.created_at)}</dd>
          <dt>Format</dt>
          <dd>
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
            <dl className="details">
              {recording.context_readings.map((c) => (
                <div key={c.id} className="details-pair">
                  <dt>{c.name}</dt>
                  <dd>
                    {c.value} {c.unit}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="muted small">Entered by you when uploading.</p>
          </>
        )}
      </section>

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
            <p>
              The anomaly model is still being evaluated and has not passed validation, so this recording
              cannot be analysed yet. Your recording is stored and its format is valid; nothing else was
              saved.
            </p>
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
    </>
  );
}
