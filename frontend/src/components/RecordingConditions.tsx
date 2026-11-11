"use client";

import { useId } from "react";
import type { ContextInput } from "@/lib/api";
import { MODEL_INPUTS, RESERVED_INPUT_NAMES, rangeNotice, type MachineType } from "@/lib/modelInputs";

// Optional details stored with an upload: operating conditions, other
// readings and when it was recorded. Collapsed under "Advanced details".
// ADR-006: the acoustic model does not use any of these values; they are kept
// for the user's records and for the comparisons on the machine page.

export type ContextRow = { key: number; name: string; value: string; unit: string };

export type ConditionsValue = {
  model: Record<string, string>;
  rows: ContextRow[];
  recordedAt: string;
};

export const EMPTY_CONDITIONS: ConditionsValue = { model: {}, rows: [], recordedAt: "" };

// Suggestions only; the technician enters any name and unit they measured.
const SUGGESTED_CONTEXT = [{ name: "load", unit: "%" }];

let nextKey = 1;
const emptyRow = (): ContextRow => ({ key: nextKey++, name: "", value: "", unit: "" });

/** Validates the entered values. Returns the readings to store, or a user-facing error. */
export function parseConditions(type: MachineType, value: ConditionsValue): ContextInput[] | string {
  const out: ContextInput[] = [];
  for (const input of MODEL_INPUTS[type]) {
    const raw = (value.model[input.name] ?? "").trim();
    if (raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) return `${input.label}: "${raw}" is not a number.`;
    out.push({ name: input.name, value: n, unit: input.unit });
  }
  const filled = value.rows.filter((r) => r.name.trim() || r.value.trim() || r.unit.trim());
  const seen = new Set<string>();
  for (const r of filled) {
    const name = r.name.trim().toLowerCase();
    const unit = r.unit.trim();
    const n = Number(r.value.trim());
    if (!name || !unit || r.value.trim() === "") return "Each other reading needs a name, a value and a unit.";
    if (!Number.isFinite(n)) return `"${r.value}" is not a number.`;
    if (RESERVED_INPUT_NAMES.has(name)) return `"${name}" has its own field under operating conditions; use that instead.`;
    if (seen.has(name)) return `"${name}" is entered twice.`;
    seen.add(name);
    out.push({ name, value: n, unit });
  }
  return out;
}

/** The recorded-at field as an ISO timestamp, or null when left blank. */
export function recordedAtIso(value: ConditionsValue): string | null {
  return value.recordedAt ? new Date(value.recordedAt).toISOString() : null;
}

export function countEntered(value: ConditionsValue): number {
  const model = Object.values(value.model).filter((v) => v.trim() !== "").length;
  const rows = value.rows.filter((r) => r.name.trim() || r.value.trim()).length;
  return model + rows + (value.recordedAt ? 1 : 0);
}

type Props = {
  machineType: MachineType;
  value: ConditionsValue;
  onChange: (value: ConditionsValue) => void;
  disabled?: boolean;
  /** Shown under the summary, e.g. that values apply to every file in a batch. */
  scopeNote?: string;
};

export function RecordingConditions({ machineType, value, onChange, disabled = false, scopeNote }: Props) {
  const uid = useId();
  const inputs = MODEL_INPUTS[machineType];
  const entered = countEntered(value);

  function updateRow(key: number, patch: Partial<ContextRow>) {
    onChange({ ...value, rows: value.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  }

  return (
    <details className="advanced">
      <summary>
        <span className="advanced-title">Advanced details</span>
        <span className="muted small">
          Optional{entered > 0 ? ` · ${entered} entered` : " · operating conditions, readings, recording time"}
        </span>
      </summary>
      <fieldset className="advanced-body" disabled={disabled}>
        <legend className="visually-hidden">Advanced details</legend>
        <p className="muted small">
          Stored with the recording for your records and for comparisons on the machine page. These values are{" "}
          <strong>not used by the acoustic model</strong>; leaving them blank does not change any result.
          {scopeNote ? ` ${scopeNote}` : ""}
        </p>

        <div className="field">
          <label htmlFor={`${uid}-recorded-at`}>
            Recorded at <span className="muted">(optional)</span>
          </label>
          <input
            id={`${uid}-recorded-at`}
            type="datetime-local"
            value={value.recordedAt}
            onChange={(e) => onChange({ ...value, recordedAt: e.target.value })}
          />
        </div>

        {inputs.length > 0 && (
          <div className="advanced-group">
            <p className="advanced-group-title">Operating conditions</p>
            <div className="field-row field-row-wrap">
              {inputs.map((input) => {
                const raw = value.model[input.name] ?? "";
                const notice =
                  raw.trim() === "" ? null : rangeNotice(machineType, input.name, Number(raw), input.unit);
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
                      onChange={(e) => onChange({ ...value, model: { ...value.model, [input.name]: e.target.value } })}
                    />
                    <p id={`${id}-range`} className="muted small">
                      Test data covered {input.min}–{input.max} {input.unit}
                    </p>
                    {notice && (
                      <p id={`${id}-notice`} className="notice notice-warning small" role="status">
                        {notice}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="advanced-group">
          <p className="advanced-group-title">Other readings</p>
          <p className="muted small">Any other values you measured or read off the machine while recording.</p>
          {value.rows.map((row, index) => (
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
                    updateRow(row.key, {
                      name: e.target.value,
                      ...(suggestion && !row.unit ? { unit: suggestion.unit } : {}),
                    });
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
                onClick={() => onChange({ ...value, rows: value.rows.filter((r) => r.key !== row.key) })}
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
          <div>
            <button
              type="button"
              className="button-secondary btn-sm"
              onClick={() => onChange({ ...value, rows: [...value.rows, emptyRow()] })}
            >
              Add reading
            </button>
          </div>
        </div>
      </fieldset>
    </details>
  );
}
