"use client";

import { useId, useState, type FormEvent } from "react";
import type { MachineInput } from "@/lib/api";
import { MACHINE_TYPES, type MachineType } from "@/lib/modelInputs";
import { ErrorMessage } from "./Status";

type Props = {
  initial?: MachineInput;
  submitLabel: string;
  onSubmit: (input: MachineInput) => Promise<void>;
  onCancel?: () => void;
};

const blank: MachineInput = { name: "", machine_type: "other", location: null, notes: null };

function orNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

export function MachineForm({ initial = blank, submitLabel, onSubmit, onCancel }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Unique per instance: a hidden, still-mounted route may hold another copy.
  const uid = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const name = String(form.get("name") ?? "").trim();
    if (!name) {
      setError("Enter a machine name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name,
        machine_type: String(form.get("machine_type")) as MachineType,
        location: orNull(form.get("location")),
        notes: orNull(form.get("notes")),
      });
      if (!initial.name) formEl.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="field">
        <label htmlFor={`${uid}-name`}>Name</label>
        <input id={`${uid}-name`} name="name" required maxLength={120} defaultValue={initial.name} />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${uid}-type`}>Machine type</label>
          <select
            id={`${uid}-type`}
            name="machine_type"
            defaultValue={initial.machine_type}
            aria-describedby={`${uid}-type-help`}
          >
            {MACHINE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <p id={`${uid}-type-help`} className="muted small">
            Analysis is being developed for bearings and gearboxes only.
          </p>
        </div>
        <div className="field">
          <label htmlFor={`${uid}-location`}>
            Location <span className="muted">(optional)</span>
          </label>
          <input id={`${uid}-location`} name="location" maxLength={200} defaultValue={initial.location ?? ""} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-notes`}>
          Notes <span className="muted">(optional)</span>
        </label>
        <textarea id={`${uid}-notes`} name="notes" rows={3} maxLength={2000} defaultValue={initial.notes ?? ""} />
      </div>
      <div className="actions">
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="button-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
