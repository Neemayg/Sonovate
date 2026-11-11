"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { friendlyAnalysisError, type FriendlyError } from "@/lib/analysisMessages";
import {
  BASELINE_REQUIRED,
  createRecording,
  listPredictions,
  requestAnalysis,
  type AnalysisResult,
  type Recording,
} from "@/lib/api";
import { ACCEPT_ATTRIBUTE, formatBytes, isAcceptedFile } from "@/lib/batch";
import { prepareRecording } from "@/lib/convert";
import type { MachineType } from "@/lib/modelInputs";
import {
  EMPTY_CONDITIONS,
  parseConditions,
  recordedAtIso,
  RecordingConditions,
  type ConditionsValue,
} from "./RecordingConditions";
import { ErrorMessage } from "./Status";
import { useLeaveGuard } from "./useLeaveGuard";

// One new recording, uploaded and then analysed without a second click.
// Every stage below is a real step that finishes before the next starts:
// converting in the browser, the existing upload (createRecording), the
// existing analysis request (requestAnalysis) and reading back the stored
// result. No percentages are shown because none are measured.

type Stage = "preparing" | "uploading" | "comparing" | "generating" | "complete";

const STAGES: { id: Stage; label: string }[] = [
  { id: "preparing", label: "Preparing audio" },
  { id: "uploading", label: "Uploading recording" },
  { id: "comparing", label: "Comparing against machine baseline" },
  { id: "generating", label: "Generating result" },
  { id: "complete", label: "Analysis complete" },
];

type Outcome =
  | { kind: "info"; title: string; message: string }
  | { kind: "error"; code: string; error: FriendlyError };

function outcomeFor(result: Exclude<AnalysisResult, { status: "completed" }>): Outcome {
  switch (result.status) {
    case "baseline_required":
      return {
        kind: "info",
        title: `Baseline needed: ${result.count}/${result.required}`,
        message: `Add ${result.required - result.count} more baseline recordings before this machine can be checked. Your recording is saved and can be analysed later.`,
      };
    case "unsupported_machine_type":
      return { kind: "info", title: "Not available for this machine type", message: result.message };
    case "no_validated_model":
      return { kind: "info", title: "No validated model yet", message: result.message };
    case "baseline_recording":
      return { kind: "info", title: "Baseline recording", message: result.message };
    case "error":
      return { kind: "error", code: result.code, error: friendlyAnalysisError(result.code, result.message) };
  }
}

type Props = {
  machineId: string;
  machineType: MachineType;
  baselineCount: number;
  /** False for machine types without a model: the recording is stored, not analysed. */
  analysable: boolean;
  onUploaded: (recording: Recording) => Promise<void> | void;
  onNeedBaselines?: () => void;
};

export function CheckUploader({ machineId, machineType, baselineCount, analysable, onUploaded, onNeedBaselines }: Props) {
  const router = useRouter();
  const uid = useId();
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [conditions, setConditions] = useState<ConditionsValue>(EMPTY_CONDITIONS);
  const [dragging, setDragging] = useState(false);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const locked = analysable && baselineCount < BASELINE_REQUIRED;
  const busy = stage !== null && stage !== "complete";

  // Local preview of the picked file; the URL is released when it changes.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  useLeaveGuard(
    busy,
    "This check is still running. If you leave this page, the upload and analysis continue in the background and the result will be on the recording's page. Leave anyway?",
  );

  // If the user moved to another page mid-check, do not pull them back to the result.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function pick(next: File | undefined) {
    if (!next || busyRef.current) return;
    setOutcome(null);
    setRecording(null);
    setNote(null);
    setStage(null);
    if (!isAcceptedFile(next)) {
      setInputError(`${next.name} is not a supported format. Use WAV, MP3, M4A, MP4 or MOV.`);
      setFile(null);
      return;
    }
    setInputError(null);
    setFile(next);
  }

  async function analyse(target: Recording) {
    setOutcome(null);
    setStage("comparing");
    const result = await requestAnalysis(target.id);
    if (result.status !== "completed") {
      setStage(null);
      setOutcome(outcomeFor(result));
      return;
    }
    setStage("generating");
    try {
      // The result page shows exactly what was stored; check it is readable first.
      await listPredictions(target.id);
    } catch {
      // The result is stored even if this read fails; the result page reloads it.
    }
    setStage("complete");
    if (mountedRef.current) router.push(`/recordings/${target.id}`);
  }

  async function start() {
    if (busyRef.current || !file || locked) return;
    const context = parseConditions(machineType, conditions);
    if (typeof context === "string") {
      setInputError(context);
      return;
    }
    busyRef.current = true;
    setInputError(null);
    setOutcome(null);
    try {
      setStage("preparing");
      const prepared = await prepareRecording(file);
      setNote(prepared.note);
      setStage("uploading");
      const stored = await createRecording({
        machineId,
        file: prepared.file,
        wav: prepared.info,
        kind: "analysis",
        recordedAt: recordedAtIso(conditions),
        context,
      });
      setRecording(stored);
      await onUploaded(stored);
      if (!analysable) {
        setStage("complete");
        if (mountedRef.current) router.push(`/recordings/${stored.id}`);
        return;
      }
      await analyse(stored);
    } catch (err) {
      setStage(null);
      setInputError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      busyRef.current = false;
    }
  }

  async function retryAnalysis() {
    if (busyRef.current || !recording) return;
    busyRef.current = true;
    try {
      await analyse(recording);
    } finally {
      busyRef.current = false;
    }
  }

  if (locked) {
    const left = BASELINE_REQUIRED - baselineCount;
    return (
      <div className="check-locked">
        <p>
          <strong>
            {left} more baseline recording{left === 1 ? "" : "s"} needed
          </strong>
        </p>
        <p className="muted small">
          A check compares a new recording with this machine&apos;s own normal sound, so it needs at least{" "}
          {BASELINE_REQUIRED} baseline recordings first ({baselineCount}/{BASELINE_REQUIRED} so far).
        </p>
        {onNeedBaselines && (
          <button type="button" className="button-secondary" onClick={onNeedBaselines}>
            Add baseline recordings
          </button>
        )}
      </div>
    );
  }

  const stageIndex = stage ? STAGES.findIndex((s) => s.id === stage) : -1;
  const steps = analysable ? STAGES : STAGES.filter((s) => s.id === "preparing" || s.id === "uploading");

  return (
    <div className="check">
      <div
        className={`dropzone dropzone-single${dragging ? " is-dragging" : ""}${busy ? " is-disabled" : ""}`}
        onDragOver={(e: DragEvent<HTMLDivElement>) => {
          e.preventDefault();
          if (!busyRef.current) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e: DragEvent<HTMLDivElement>) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files[0]);
        }}
      >
        <input
          ref={inputRef}
          id={`${uid}-file`}
          className="visually-hidden"
          type="file"
          tabIndex={-1}
          aria-label="Choose a recording"
          accept={ACCEPT_ATTRIBUTE}
          disabled={busy}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {file ? (
          <div className="check-file">
            <span className="check-file-name">
              <strong title={file.name}>{file.name}</strong>
              <span className="muted small num">{formatBytes(file.size)}</span>
            </span>
            <button type="button" className="button-secondary btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
              Change file
            </button>
          </div>
        ) : (
          <>
            <p className="dropzone-title">Drag a recording here</p>
            <button type="button" className="button-secondary" onClick={() => inputRef.current?.click()}>
              Choose a recording
            </button>
          </>
        )}
        {preview && file && (
          <audio className="check-preview" controls preload="metadata" src={preview} aria-label={`Preview of ${file.name}`} />
        )}
        <p className="muted small dropzone-formats">
          WAV, MP3, M4A, MP4 or MOV, 10 s or longer. Record about 60 s: the check then uses six 10 s windows and
          catches more problems. Only the first 60 s of audio is uploaded; video is never uploaded.
        </p>
      </div>

      {inputError && <ErrorMessage>{inputError}</ErrorMessage>}

      {stage && (
        <ol className="stages" aria-label="Progress" aria-live="polite">
          {steps.map((s) => {
            const i = STAGES.findIndex((x) => x.id === s.id);
            const state = i < stageIndex || stage === "complete" ? "done" : i === stageIndex ? "active" : "todo";
            return (
              <li key={s.id} className={`stage is-${state}`} aria-current={state === "active" ? "step" : undefined}>
                <span className="stage-mark" aria-hidden="true">
                  {state === "active" ? <span className="spinner" /> : null}
                </span>
                <span>{s.label}</span>
              </li>
            );
          })}
        </ol>
      )}
      {note && stage && <p className="muted small">{note}</p>}

      {outcome && (
        <div className={`notice ${outcome.kind === "error" ? "notice-error" : "notice-info"}`} role="status">
          <p>
            <strong>{outcome.kind === "error" ? outcome.error.title : outcome.title}</strong>
          </p>
          <p>{outcome.kind === "error" ? outcome.error.message : outcome.message}</p>
          <div className="actions">
            {outcome.kind === "error" && outcome.error.retryable && recording && (
              <button type="button" className="btn-sm" onClick={() => void retryAnalysis()}>
                Try the analysis again
              </button>
            )}
            {outcome.kind === "error" && outcome.code === "unauthenticated" && (
              <Link href="/login" className="button-like">
                Sign in
              </Link>
            )}
            {recording && (
              <Link href={`/recordings/${recording.id}`} className="button-like">
                Open the saved recording
              </Link>
            )}
          </div>
        </div>
      )}

      <RecordingConditions machineType={machineType} value={conditions} onChange={setConditions} disabled={busy} />

      <div className="actions">
        <button type="button" onClick={() => void start()} disabled={!file || busy || recording !== null}>
          {busy ? (
            <>
              <span className="spinner" aria-hidden="true" /> Working…
            </>
          ) : analysable ? (
            "Upload and run check"
          ) : (
            "Upload recording"
          )}
        </button>
        {recording && !busy && (
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setFile(null);
              setRecording(null);
              setOutcome(null);
              setStage(null);
              setNote(null);
            }}
          >
            Start a new check
          </button>
        )}
      </div>
    </div>
  );
}
