"use client";

import { useRef, useState, type DragEvent } from "react";
import { createRecording, type Recording } from "@/lib/api";
import {
  ACCEPT_ATTRIBUTE,
  addFiles,
  canRemove,
  clearDone,
  formatBytes,
  pendingKeys,
  removeItem,
  requeueFailed,
  summarise,
  updateItem,
  type BatchItem,
  type BatchStatus,
} from "@/lib/batch";
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

// Server-side cap per machine (supabase migration deploy_hardening).
const BASELINE_CAP = 50;

const STATUS_TEXT: Record<BatchStatus, string> = {
  queued: "Waiting",
  preparing: "Preparing audio…",
  uploading: "Uploading…",
  done: "Uploaded",
  failed: "Failed",
};

type Props = {
  machineId: string;
  machineType: MachineType;
  /** Persisted baseline count for this machine (from the database). */
  baselineCount: number;
  /** Called after each file is stored; the parent re-reads the machine's recordings. */
  onUploaded: (recording: Recording) => Promise<void> | void;
};

// Several baseline recordings in one go. Each file goes through the existing
// browser conversion (lib/convert.ts) and the existing single-recording
// upload (createRecording), one after another. A failed file never undoes
// the ones already stored, and a retry only re-sends files that failed.
export function BaselineUploader({ machineId, machineType, baselineCount, onUploaded }: Props) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conditions, setConditions] = useState<ConditionsValue>(EMPTY_CONDITIONS);
  const inputRef = useRef<HTMLInputElement>(null);
  // The loop reads the latest list and guards against a second start.
  const itemsRef = useRef<BatchItem[]>(items);
  const runningRef = useRef(false);

  function commit(next: BatchItem[]) {
    itemsRef.current = next;
    setItems(next);
  }

  // Closing the tab stops the remaining uploads; moving to another page of
  // the app lets them finish in the background, out of sight.
  useLeaveGuard(
    running,
    "Baseline recordings are still uploading. If you leave this page, the remaining files keep uploading in the background, but you will not see their progress or any failures. Leave anyway?",
  );

  function add(files: File[]) {
    if (files.length === 0) return;
    const { items: next, unsupported, duplicates } = addFiles(itemsRef.current, files);
    commit(next);
    const parts: string[] = [];
    if (unsupported.length > 0) {
      parts.push(
        `${unsupported.length} file${unsupported.length === 1 ? " was" : "s were"} skipped because the format is not supported: ${unsupported.join(", ")}.`,
      );
    }
    if (duplicates.length > 0) {
      parts.push(`${duplicates.length} file${duplicates.length === 1 ? " is" : "s are"} already in the list.`);
    }
    setNotice(parts.length > 0 ? parts.join(" ") : null);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (runningRef.current) return;
    add(Array.from(e.dataTransfer.files));
  }

  /** Uploads queued files; `retry` first re-queues failed ones, `only` limits the run to one file. */
  async function run(retry: boolean, only?: string) {
    if (runningRef.current) return;
    const context = parseConditions(machineType, conditions);
    if (typeof context === "string") {
      setError(context);
      return;
    }
    if (retry) commit(requeueFailed(itemsRef.current, only));
    const keys = pendingKeys(itemsRef.current, false).filter((k) => only === undefined || k === only);
    if (keys.length === 0) return;

    runningRef.current = true;
    setRunning(true);
    setError(null);
    setNotice(null);
    const recordedAt = recordedAtIso(conditions);

    for (const key of keys) {
      const item = itemsRef.current.find((i) => i.key === key);
      if (!item || item.status !== "queued") continue;
      try {
        commit(updateItem(itemsRef.current, key, { status: "preparing", error: undefined }));
        const prepared = await prepareRecording(item.file);
        commit(updateItem(itemsRef.current, key, { status: "uploading", note: prepared.note }));
        const recording = await createRecording({
          machineId,
          file: prepared.file,
          wav: prepared.info,
          kind: "baseline",
          recordedAt,
          context,
        });
        commit(updateItem(itemsRef.current, key, { status: "done", recordingId: recording.id }));
        await onUploaded(recording);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed.";
        commit(updateItem(itemsRef.current, key, { status: "failed", error: message }));
      }
    }

    runningRef.current = false;
    setRunning(false);
  }

  const s = summarise(items);
  const toUpload = s.queued;
  const spaceLeft = Math.max(0, BASELINE_CAP - baselineCount);
  const finished = s.total > 0 && s.queued + s.preparing + s.uploading === 0;

  return (
    <div className="batch">
      <div
        className={`dropzone${dragging ? " is-dragging" : ""}${running ? " is-disabled" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!runningRef.current) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <svg className="dropzone-icon" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
          <path d="M3 14h2M7 9v10M11 5v18M15 8v12M19 11v6M23 13v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <p className="dropzone-title">Drag recordings here</p>
        <p className="muted small">or</p>
        <input
          ref={inputRef}
          id={`baseline-files-${machineId}`}
          className="visually-hidden"
          type="file"
          tabIndex={-1}
          aria-label="Choose baseline recordings"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          disabled={running}
          onChange={(e) => {
            add(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <button type="button" className="button-secondary" disabled={running} onClick={() => inputRef.current?.click()}>
          Choose files
        </button>
        <p className="muted small dropzone-formats">
          WAV, MP3, M4A, MP4 or MOV (also AAC, OGG, Opus, WebM). Each recording must be at least 10 s; videos and
          other formats are converted to 16 kHz mono audio in your browser and only that audio is uploaded. Each
          baseline uses its first 10 s.
        </p>
      </div>

      {notice && (
        <p className="notice small" role="status">
          {notice}
        </p>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}

      {items.length > 0 && (
        <>
          <div className="batch-head">
            <p className="small" role="status" aria-live="polite">
              <strong className="num">{s.done}</strong> of <span className="num">{s.total}</span> uploaded
              {s.failed > 0 && (
                <>
                  {" "}
                  · <span className="batch-failed num">{s.failed} failed</span>
                </>
              )}
              {running && " · uploading one file at a time"}
            </p>
            {!running && s.done > 0 && (
              <button type="button" className="button-link small" onClick={() => commit(clearDone(itemsRef.current))}>
                Clear uploaded
              </button>
            )}
          </div>
          <ul className="batch-list" aria-label="Files in this batch">
            {items.map((item) => (
              <li key={item.key} className={`batch-item is-${item.status}`}>
                <span className="batch-dot" aria-hidden="true" />
                <span className="batch-name">
                  <span className="batch-file" title={item.file.name}>
                    {item.file.name}
                  </span>
                  <span className="muted small num">{formatBytes(item.file.size)}</span>
                  {item.status === "failed" && item.error && <span className="batch-error small">{item.error}</span>}
                </span>
                <span className="batch-status small">
                  {(item.status === "preparing" || item.status === "uploading") && (
                    <span className="spinner" aria-hidden="true" />
                  )}
                  {STATUS_TEXT[item.status]}
                </span>
                <span className="batch-actions">
                  {item.status === "failed" && !running && (
                    <button
                      type="button"
                      className="button-secondary btn-sm"
                      onClick={() => void run(true, item.key)}
                    >
                      Retry
                    </button>
                  )}
                  {canRemove(item) && !running && (
                    <button
                      type="button"
                      className="button-link small"
                      aria-label={`Remove ${item.file.name}`}
                      onClick={() => commit(removeItem(itemsRef.current, item.key))}
                    >
                      Remove
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {toUpload > spaceLeft && (
        <p className="notice notice-warning small" role="status">
          This machine can hold {BASELINE_CAP} baseline recordings and has room for {spaceLeft} more. Files beyond that
          will fail; remove some from the list.
        </p>
      )}

      <RecordingConditions
        machineType={machineType}
        value={conditions}
        onChange={setConditions}
        disabled={running}
        scopeNote="Values entered here are stored with every file in this batch."
      />

      <div className="actions">
        <button type="button" onClick={() => void run(false)} disabled={running || toUpload === 0}>
          {running ? (
            <>
              <span className="spinner" aria-hidden="true" /> Uploading…
            </>
          ) : toUpload > 0 ? (
            `Upload ${toUpload} baseline recording${toUpload === 1 ? "" : "s"}`
          ) : (
            "Upload baseline recordings"
          )}
        </button>
        {!running && s.failed > 0 && (
          <button type="button" className="button-secondary" onClick={() => void run(true)}>
            Retry {s.failed} failed
          </button>
        )}
        {finished && s.failed === 0 && (
          <span className="muted small" role="status">
            All files uploaded.
          </span>
        )}
      </div>
    </div>
  );
}
