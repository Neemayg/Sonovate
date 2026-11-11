"use client";

import { useId, useState, type FormEvent } from "react";
import { createRecording, type ContextInput, type Recording, type RecordingKind } from "@/lib/api";
import { MODEL_INPUTS, RESERVED_INPUT_NAMES, rangeNotice, type MachineType } from "@/lib/modelInputs";
import { prepareRecording } from "@/lib/convert";
import { ErrorMessage } from "./Status";

type ContextRow = { key: number; name: string; value: string; unit: string };

// Suggestions only; the technician enters any name and unit they measured.
// Model inputs (speed, voltage, weight) have their own fields above.
const SUGGESTED_CONTEXT = [
  { name: "load", unit: "%" },
];

let nextKey = 1;
const emptyRow = (): ContextRow => ({ key: nextKey++, name: "", value: "", unit: "" });

function parseModelInputs(type: MachineType, values: Record<string, string>): ContextInput[] | string {
  const out: ContextInput[] = [];
  for (const input of MODEL_INPUTS[type]) {
    const raw = (values[input.name] ?? "").trim();
    if (raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) return `${input.label}: "${raw}" is not a number.`;
    out.push({ name: input.name, value, unit: input.unit });
  }
  return out;
}

function parseContext(rows: ContextRow[]): ContextInput[] | string {
  const filled = rows.filter((r) => r.name.trim() || r.value.trim() || r.unit.trim());
  const seen = new Set<string>();
  const out: ContextInput[] = [];
  for (const r of filled) {
    const name = r.name.trim().toLowerCase();
    const unit = r.unit.trim();
    const value = Number(r.value.trim());
    if (!name || !unit || r.value.trim() === "") return "Each other reading needs a name, a value and a unit.";
    if (!Number.isFinite(value)) return `"${r.value}" is not a number.`;
    if (RESERVED_INPUT_NAMES.has(name)) return `"${name}" has its own field under operating conditions; use that instead.`;
    if (seen.has(name)) return `"${name}" is entered twice.`;
    seen.add(name);
    out.push({ name, value, unit });
  }
  return out;
}

// "Now" in the format a datetime-local input expects (local time, minutes).
function nowLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

type Props = {
  machineId: string;
  machineType: MachineType;
  defaultKind?: RecordingKind;
  // Called once per saved recording; several in a row for a batch of baselines.
  onUploaded: (r: Recording) => void;
};

export function UploadForm({ machineId, machineType, defaultKind = "analysis", onUploaded }: Props) {
  const [modelValues, setModelValues] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<ContextRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [kind, setKind] = useState<RecordingKind>(defaultKind);
  const [lastDefault, setLastDefault] = useState<RecordingKind>(defaultKind);
  const [recordedAt, setRecordedAt] = useState<string>(nowLocal);
  const uid = useId();

  // Follow a new default (e.g. analysis once the baseline is complete), but
  // never switch the purpose in the middle of an upload.
  if (defaultKind !== lastDefault && !busy) {
    setLastDefault(defaultKind);
    setKind(defaultKind);
  }

  function updateRow(key: number, patch: Partial<ContextRow>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) {
      setError(kind === "baseline" ? "Choose one or more recordings to upload." : "Choose a recording or video to upload.");
      return;
    }
    const typed = parseModelInputs(machineType, modelValues);
    const other = parseContext(rows);
    if (typeof typed === "string" || typeof other === "string") {
      setError(typeof typed === "string" ? typed : (other as string));
      return;
    }
    const context = [...typed, ...other];
    setBusy(true);
    setError(null);
    setStatus(null);
    // Filled in with the upload time by default; the user can change it.
    const recordedAtIso = recordedAt ? new Date(recordedAt).toISOString() : new Date().toISOString();
    const failures: string[] = [];
    let saved = 0;
    let lastNote: string | null = null;
    for (const [index, file] of files.entries()) {
      const prefix = files.length > 1 ? `${index + 1} of ${files.length} · ${file.name}: ` : "";
      try {
        setStatus(`${prefix}Checking the recording…`);
        const prepared = await prepareRecording(file);
        setStatus(`${prefix}${prepared.note ? `${prepared.note} ` : ""}Uploading…`);
        const recording = await createRecording({
          machineId,
          file: prepared.file,
          wav: prepared.info,
          kind,
          recordedAt: recordedAtIso,
          context,
        });
        saved++;
        lastNote = prepared.note;
        onUploaded(recording);
      } catch (err) {
        failures.push(`${file.name}: ${err instanceof Error ? err.message : "upload failed."}`);
      }
    }
    setBusy(false);
    if (failures.length > 0) {
      setStatus(saved > 0 ? `Saved ${saved} of ${files.length} recordings.` : null);
      setError(failures.length === 1 && files.length === 1 ? failures[0] : `Not saved — ${failures.join(" · ")}`);
      return;
    }
    formEl.reset();
    setRows([]);
    setModelValues({});
    setRecordedAt(nowLocal());
    setStatus(files.length > 1 ? `Saved all ${saved} recordings.` : lastNote);
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate aria-describedby={`${uid}-help`}>
      <p id={`${uid}-help`} className="muted small">
        A recording or video of at least 10 s: WAV, MP3, M4A, or an MP4/MOV video with sound. Other formats are
        converted to 16 kHz mono in your browser (the first 60 s are used) and only that audio is uploaded. Record
        60 s per check: the result then uses six 10 s windows and catches more problems. Baseline recordings use
        their first 10 s.
      </p>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {status && !error && (
        <p className="muted small" role="status">
          {status}
        </p>
      )}
      <div className="field">
        <label htmlFor={`${uid}-file`}>Recording file</label>
        <input
          id={`${uid}-file`}
          name="file"
          type="file"
          accept="audio/*,video/*,.wav,.mp3,.m4a,.aac,.ogg,.opus,.mp4,.mov,.webm"
          multiple={kind === "baseline"}
          aria-describedby={`${uid}-file-help`}
          required
        />
        <p id={`${uid}-file-help`} className="muted small">
          {kind === "baseline"
            ? "You can select several baseline recordings at once; they are saved one after another."
            : "One recording per analysis. It is analysed as soon as it is uploaded."}
        </p>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${uid}-kind`}>Purpose</label>
          <select
            id={`${uid}-kind`}
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as RecordingKind)}
            disabled={busy}
            aria-describedby={`${uid}-kind-help`}
          >
            <option value="analysis">Analysis</option>
            <option value="baseline">Baseline (machine running normally)</option>
          </select>
          <p id={`${uid}-kind-help`} className="muted small">
            Baseline recordings set this machine&apos;s threshold and are not analysed.
          </p>
        </div>
        <div className="field">
          <label htmlFor={`${uid}-recorded-at`}>Recorded at</label>
          <input
            id={`${uid}-recorded-at`}
            name="recorded_at"
            type="datetime-local"
            value={recordedAt}
            onChange={(e) => setRecordedAt(e.target.value)}
            aria-describedby={`${uid}-recorded-at-help`}
          />
          <p id={`${uid}-recorded-at-help`} className="muted small">
            Filled in with the current date and time. Change it if the recording was made earlier.
          </p>
        </div>
      </div>

      {MODEL_INPUTS[machineType].length > 0 && (
        <fieldset className="fieldset">
          <legend>
            Operating conditions <span className="muted">(optional)</span>
          </legend>
          <p className="muted small">
            The settings the {machineType} model understands. Leave blank if you don&apos;t know them.
          </p>
          {MODEL_INPUTS[machineType].map((input) => {
            const raw = modelValues[input.name] ?? "";
            const notice = raw.trim() === "" ? null : rangeNotice(machineType, input.name, Number(raw), input.unit);
            const id = `${uid}-model-${input.name}`;
            return (
              <div className="field" key={input.name}>
                <label htmlFor={id}>
                  {input.label} ({input.unit})
                </label>
                <input
                  id={id}
                  inputMode="decimal"
                  value={raw}
                  aria-describedby={`${id}-range${notice ? ` ${id}-notice` : ""}`}
                  onChange={(e) => setModelValues((v) => ({ ...v, [input.name]: e.target.value }))}
                />
                <p id={`${id}-range`} className="muted small">
                  Validated range: {input.min}–{input.max} {input.unit}
                </p>
                {notice && (
                  <p id={`${id}-notice`} className="notice notice-warning small" role="status">
                    {notice}
                  </p>
                )}
              </div>
            );
          })}
        </fieldset>
      )}

      <fieldset className="fieldset">
        <legend>
          Other readings <span className="muted">(optional)</span>
        </legend>
        <p className="muted small">Any other values you measured or read off the machine while recording.</p>
        {rows.map((row, index) => (
          <div className="context-row" key={row.key}>
            <div className="field">
              <label htmlFor={`${uid}-ctx-name-${row.key}`}>
                Name <span className="visually-hidden">of reading {index + 1}</span>
              </label>
              <input
                id={`${uid}-ctx-name-${row.key}`}
                list={`${uid}-suggestions`}
                maxLength={60}
                value={row.name}
                onChange={(e) => {
                  const suggestion = SUGGESTED_CONTEXT.find((s) => s.name === e.target.value.trim().toLowerCase());
                  updateRow(row.key, { name: e.target.value, ...(suggestion && !row.unit ? { unit: suggestion.unit } : {}) });
                }}
              />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-ctx-value-${row.key}`}>
                Value <span className="visually-hidden">of reading {index + 1}</span>
              </label>
              <input
                id={`${uid}-ctx-value-${row.key}`}
                inputMode="decimal"
                value={row.value}
                onChange={(e) => updateRow(row.key, { value: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-ctx-unit-${row.key}`}>
                Unit <span className="visually-hidden">of reading {index + 1}</span>
              </label>
              <input
                id={`${uid}-ctx-unit-${row.key}`}
                maxLength={30}
                value={row.unit}
                onChange={(e) => updateRow(row.key, { unit: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="button-secondary"
              aria-label={`Remove reading ${index + 1}`}
              onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
            >
              Remove
            </button>
          </div>
        ))}
        <datalist id={`${uid}-suggestions`}>
          {SUGGESTED_CONTEXT.map((s) => (
            <option key={s.name} value={s.name} />
          ))}
        </datalist>
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            const row = emptyRow();
            setRows((r) => [...r, row]);
          }}
        >
          Add reading
        </button>
      </fieldset>

      <div className="actions">
        <button type="submit" disabled={busy}>
          {busy ? "Uploading…" : kind === "baseline" ? "Upload baseline recordings" : "Upload and analyse"}
        </button>
      </div>
    </form>
  );
}
