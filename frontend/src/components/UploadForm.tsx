"use client";

import { useId, useState, type FormEvent } from "react";
import { createRecording, type ContextInput, type Recording, type RecordingKind } from "@/lib/api";
import { MODEL_INPUTS, RESERVED_INPUT_NAMES, rangeNotice, type MachineType } from "@/lib/modelInputs";
import { checkWav } from "@/lib/wav";
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

type Props = { machineId: string; machineType: MachineType; onUploaded: (r: Recording) => void };

export function UploadForm({ machineId, machineType, onUploaded }: Props) {
  const [modelValues, setModelValues] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<ContextRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = useId();

  function updateRow(key: number, patch: Partial<ContextRow>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a WAV file to upload.");
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
    try {
      const wav = await checkWav(file);
      if (!wav.ok) {
        setError(wav.message);
        return;
      }
      const recordedAtRaw = String(form.get("recorded_at") ?? "");
      const recording = await createRecording({
        machineId,
        file,
        wav: wav.info,
        kind: String(form.get("kind")) as RecordingKind,
        recordedAt: recordedAtRaw ? new Date(recordedAtRaw).toISOString() : null,
        context,
      });
      formEl.reset();
      setRows([]);
      setModelValues({});
      onUploaded(recording);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate aria-describedby={`${uid}-help`}>
      <p id={`${uid}-help`} className="muted small">
        WAV, 16 kHz, mono, 10 seconds, up to 2 MiB.
      </p>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="field">
        <label htmlFor={`${uid}-file`}>Recording file</label>
        <input id={`${uid}-file`} name="file" type="file" accept=".wav,audio/wav,audio/x-wav" required />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${uid}-kind`}>Purpose</label>
          <select id={`${uid}-kind`} name="kind" defaultValue="analysis">
            <option value="analysis">Analysis</option>
            <option value="baseline">Baseline (known normal operation)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${uid}-recorded-at`}>
            Recorded at <span className="muted">(optional)</span>
          </label>
          <input id={`${uid}-recorded-at`} name="recorded_at" type="datetime-local" />
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
          {busy ? "Uploading…" : "Upload recording"}
        </button>
      </div>
    </form>
  );
}
