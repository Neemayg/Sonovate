"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { deleteRecording, downloadRecordingAudio, type HistoryEntry } from "@/lib/api";
import { MODEL_INPUTS, type MachineType } from "@/lib/modelInputs";
import { recordingNumbers, formatDuration, recordingLabel } from "@/lib/monitoring";
import { EmptyState } from "./MonitoringStatus";
import { formatDateTime } from "./Status";

// The machine's recordings, split into normal references (baselines) and
// checks. Friendly names come from kind and date; the original filename is
// kept as secondary text. Every stored recording stays reachable.

const PAGE = 10;

type Tab = "baseline" | "analysis";
type Sort = "newest" | "oldest";

function when(e: HistoryEntry): string {
  return e.recorded_at ?? e.created_at;
}

export function conditionsText(e: HistoryEntry, type: MachineType): string {
  const parts = e.context_readings.map((c) => {
    const input = MODEL_INPUTS[type].find((i) => i.name === c.name);
    return `${input?.label ?? c.name} ${c.value} ${c.unit}`;
  });
  return parts.join(" · ");
}

function latestPrediction(e: HistoryEntry) {
  if (e.predictions.length === 0) return null;
  return e.predictions.reduce((a, b) => (b.created_at > a.created_at ? b : a));
}

// Plays a stored baseline on demand; the file is fetched with the user's own
// session only when asked for.
function InlinePlayer({ entry, label }: { entry: HistoryEntry; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  if (url) {
    return <audio className="rec-audio" controls autoPlay src={url} aria-label={`Play ${label}`} />;
  }
  return (
    <button
      type="button"
      className="button-secondary btn-sm"
      disabled={state === "loading"}
      onClick={async () => {
        setState("loading");
        try {
          const blob = await downloadRecordingAudio(entry.storage_path);
          setUrl(URL.createObjectURL(blob));
          setState("idle");
        } catch {
          setState("error");
        }
      }}
      aria-label={`Play ${label}`}
    >
      {state === "loading" ? "Loading…" : state === "error" ? "Retry play" : "▶ Play"}
    </button>
  );
}

function DeleteButton({ entry, label, onDeleted }: { entry: HistoryEntry; label: string; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!confirming) {
    return (
      <button type="button" className="button-link small rec-delete" onClick={() => setConfirming(true)} aria-label={`Delete ${label}`}>
        Delete
      </button>
    );
  }
  return (
    <span className="rec-confirm" role="group" aria-label={`Confirm deleting ${label}`}>
      <span className="small">Delete this recording? The threshold is recomputed at the next check.</span>
      <button
        type="button"
        className="button-danger btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await deleteRecording(entry);
            onDeleted();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not delete the recording.");
            setBusy(false);
          }
        }}
      >
        {busy ? "Deleting…" : "Yes, delete"}
      </button>
      <button type="button" className="button-secondary btn-sm" disabled={busy} onClick={() => setConfirming(false)}>
        Cancel
      </button>
      {error && <span className="small batch-error">{error}</span>}
    </span>
  );
}

type Props = {
  machineType: MachineType;
  entries: HistoryEntry[];
  analysable: boolean;
  onChanged: () => void;
  onAddBaselines?: () => void;
  onRunCheck?: () => void;
};

export function RecordingArea({ machineType, entries, analysable, onChanged, onAddBaselines, onRunCheck }: Props) {
  const baselines = entries.filter((e) => e.kind === "baseline");
  const checks = entries.filter((e) => e.kind === "analysis");
  const [tab, setTab] = useState<Tab>(analysable && baselines.length > 0 && checks.length === 0 ? "baseline" : checks.length > 0 ? "analysis" : "baseline");
  const [sort, setSort] = useState<Sort>("newest");
  const [shown, setShown] = useState(PAGE);
  const numbers = useMemo(() => recordingNumbers(entries), [entries]);

  const list = (tab === "baseline" ? baselines : checks)
    .slice()
    .sort((a, b) => (sort === "newest" ? when(b).localeCompare(when(a)) : when(a).localeCompare(when(b))));
  const visible = list.slice(0, shown);

  return (
    <div className="rec-area">
      <div className="rec-toolbar">
        <div className="filters" role="group" aria-label="Recording type">
          <button type="button" aria-pressed={tab === "baseline"} onClick={() => { setTab("baseline"); setShown(PAGE); }}>
            Baselines <span className="num">{baselines.length}</span>
          </button>
          <button type="button" aria-pressed={tab === "analysis"} onClick={() => { setTab("analysis"); setShown(PAGE); }}>
            Checks <span className="num">{checks.length}</span>
          </button>
        </div>
        {list.length > 1 && (
          <label className="rec-sort small">
            <span>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
        )}
      </div>

      <p className="muted small rec-tab-help">
        {tab === "baseline"
          ? "Normal reference recordings, made while the machine runs as expected. They set this machine's threshold and are never analysed."
          : "New recordings compared with the normal references. Open one to see its result and listen to it next to a normal recording."}
      </p>

      {list.length === 0 ? (
        tab === "baseline" ? (
          <EmptyState
            title="No recordings yet"
            action={onAddBaselines && <button type="button" className="btn-sm" onClick={onAddBaselines}>Add baseline recordings</button>}
          >
            Add normal baseline recordings to get started.
          </EmptyState>
        ) : (
          <EmptyState
            title="No checks yet"
            action={analysable && baselines.length >= 10 && onRunCheck && <button type="button" className="btn-sm" onClick={onRunCheck}>Run a check</button>}
          >
            {analysable
              ? baselines.length >= 10
                ? "Your machine is ready. Upload a recording to run its first check."
                : "Checks become available once the machine has 10 baseline recordings."
              : "Recordings stored for this machine appear here."}
          </EmptyState>
        )
      ) : (
        <ul className="rec-list">
          {visible.map((e) => {
            const label = recordingLabel(e, numbers.get(e.id));
            const conditions = conditionsText(e, machineType);
            const p = latestPrediction(e);
            return (
              <li key={e.id} className={`rec-row is-${e.kind}`}>
                <div className="rec-main">
                  <Link href={`/recordings/${e.id}`} className="rec-name">
                    {label}
                  </Link>
                  <span className="muted small rec-meta">
                    <span className={`tag tag-${e.kind}`}>{e.kind === "baseline" ? "Normal reference" : "Check"}</span>
                    <span>{formatDateTime(when(e))}</span>
                    <span>{formatDuration(e.duration_seconds)}</span>
                    {conditions && <span>{conditions}</span>}
                  </span>
                  {e.original_filename && (
                    <span className="muted small rec-file" title={e.original_filename}>
                      File: {e.original_filename}
                    </span>
                  )}
                </div>
                <div className="rec-side">
                  {e.kind === "analysis" ? (
                    <>
                      {p ? (
                        <span className={`decision-pill${p.decision === "above_threshold" ? " is-above" : ""}`}>
                          {p.decision === "above_threshold" ? "Above threshold" : "Within threshold"}
                        </span>
                      ) : (
                        <span className="decision-pill is-pending">Not analysed</span>
                      )}
                      <Link href={`/recordings/${e.id}`} className="button-like btn-sm">
                        Open result
                      </Link>
                    </>
                  ) : (
                    <>
                      <InlinePlayer entry={e} label={label} />
                      <DeleteButton entry={e} label={label} onDeleted={onChanged} />
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {list.length > shown && (
        <button type="button" className="button-link" onClick={() => setShown((n) => n + PAGE)}>
          Show more ({list.length - shown} more)
        </button>
      )}
      {list.length > PAGE && shown >= list.length && (
        <button type="button" className="button-link" onClick={() => setShown(PAGE)}>
          Show fewer
        </button>
      )}
    </div>
  );
}
