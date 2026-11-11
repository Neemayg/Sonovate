"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createMachine } from "@/lib/api";
import type { MachineType } from "@/lib/modelInputs";
import { ErrorMessage } from "./Status";

// Two-step machine registration: choose the category, then name it. No type
// is preselected. Bearing and gearbox are the categories the acoustic model
// was built and tested on (ADR-002); "other" is stored without analysis.

type Choice = {
  value: MachineType;
  title: string;
  description: string;
  examples: string;
  supported: boolean;
  icon: ReactNode;
};

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true" focusable="false" className="type-icon">
      {children}
    </svg>
  );
}

const CHOICES: Choice[] = [
  {
    value: "bearing",
    title: "Bearing",
    description: "Rotating components that support shafts.",
    examples: "Found in motors, pumps, fans and other industrial rotating equipment.",
    supported: true,
    icon: (
      <Glyph>
        <circle cx="18" cy="18" r="13" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="18" cy="18" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <circle
            key={a}
            cx={18 + 9 * Math.cos((a * Math.PI) / 180)}
            cy={18 + 9 * Math.sin((a * Math.PI) / 180)}
            r="2.1"
            fill="currentColor"
          />
        ))}
      </Glyph>
    ),
  },
  {
    value: "gearbox",
    title: "Gearbox",
    description: "Mechanical systems that transmit power through gears.",
    examples: "For example industrial gear drives and transmission systems.",
    supported: true,
    icon: (
      <Glyph>
        <circle cx="13" cy="20" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2.6 1.8" />
        <circle cx="13" cy="20" r="2.2" fill="currentColor" />
        <circle cx="25" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2.2 1.6" />
        <circle cx="25" cy="12" r="1.6" fill="currentColor" />
      </Glyph>
    ),
  },
  {
    value: "other",
    title: "Other",
    description: "Register other equipment for record keeping.",
    examples: "Acoustic analysis is currently unavailable for this category.",
    supported: false,
    icon: (
      <Glyph>
        <rect x="7" y="9" width="22" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 15h12M12 20h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </Glyph>
    ),
  },
];

function orNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

export function NewMachineWizard() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [type, setType] = useState<MachineType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the new step's heading so keyboard and screen-reader users follow the change.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const chosen = CHOICES.find((c) => c.value === type) ?? null;

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !type) return;
    const form = new FormData(event.currentTarget);
    const trimmed = String(form.get("name") ?? "").trim();
    if (!trimmed) {
      setError("Enter a machine name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const machine = await createMachine({
        name: trimmed,
        machine_type: type,
        location: orNull(form.get("location")),
        notes: orNull(form.get("notes")),
      });
      router.push(`/machines/${machine.id}?setup=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the machine.");
      setSaving(false);
    }
  }

  return (
    <div className="wizard">
      <ol className="wizard-steps" aria-label="Steps">
        <li className={step === 1 ? "is-current" : "is-done"} aria-current={step === 1 ? "step" : undefined}>
          <span className="num">1</span> Machine type
        </li>
        <li className={step === 2 ? "is-current" : undefined} aria-current={step === 2 ? "step" : undefined}>
          <span className="num">2</span> Machine information
        </li>
      </ol>

      {step === 1 ? (
        <section className="card wizard-card" aria-labelledby="wizard-step-1">
          <h2 id="wizard-step-1" ref={headingRef} tabIndex={-1}>
            What type of machine are you monitoring?
          </h2>
          <p className="muted">
            Sonovate&apos;s acoustic model was built and tested on two categories of rotating machinery. Choose the one
            you will record.
          </p>
          <div className="type-grid" role="radiogroup" aria-labelledby="wizard-step-1">
            {CHOICES.map((c) => (
              <label key={c.value} className={`type-card${type === c.value ? " is-selected" : ""}`}>
                <input
                  type="radio"
                  name="machine_type"
                  value={c.value}
                  checked={type === c.value}
                  onChange={() => {
                    setType(c.value);
                    setError(null);
                  }}
                  className="visually-hidden"
                />
                <span className="type-card-top">
                  {c.icon}
                  <span className={`type-badge${c.supported ? " is-supported" : ""}`}>
                    {c.supported ? "Acoustic analysis supported" : "Records only"}
                  </span>
                </span>
                <span className="type-title">{c.title}</span>
                <span className="type-desc">{c.description}</span>
                <span className="muted small">{c.examples}</span>
                <span className="type-check" aria-hidden="true" />
              </label>
            ))}
          </div>
          <p className="muted small">
            The supported categories are based on lab recordings of bearings and gearboxes. A motor or pump is not
            automatically covered: choose the category that matches the component you will record, and treat results
            as screening, not diagnosis.
          </p>
          {error && <ErrorMessage>{error}</ErrorMessage>}
          <div className="actions wizard-actions">
            <Link href="/machines" className="button-like">
              Cancel
            </Link>
            <button
              type="button"
              onClick={() => {
                if (!type) {
                  setError("Choose a machine type to continue.");
                  return;
                }
                setError(null);
                setStep(2);
              }}
              aria-disabled={!type}
              className={!type ? "is-inactive" : undefined}
            >
              Continue
            </button>
          </div>
        </section>
      ) : (
        <section className="card wizard-card" aria-labelledby="wizard-step-2">
          <h2 id="wizard-step-2" ref={headingRef} tabIndex={-1}>
            Machine information
          </h2>
          {chosen && (
            <p className="wizard-chosen">
              {chosen.icon}
              <span>
                <strong>{chosen.title}</strong>
                <span className="muted small">
                  {chosen.supported ? "Acoustic analysis supported" : "Records only, no acoustic analysis"}
                </span>
              </span>
              <button type="button" className="button-link small" onClick={() => setStep(1)} disabled={saving}>
                Change
              </button>
            </p>
          )}
          <form className="form" onSubmit={handleCreate} noValidate>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="field">
              <label htmlFor="new-machine-name">Machine name</label>
              <input
                id="new-machine-name"
                name="name"
                required
                maxLength={120}
                placeholder="e.g. Main Water Pump"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-describedby="new-machine-name-help"
              />
              <p id="new-machine-name-help" className="muted small">
                A name your team recognises on the floor.
              </p>
            </div>
            <div className="field">
              <label htmlFor="new-machine-location">
                Location <span className="muted">(optional)</span>
              </label>
              <input
                id="new-machine-location"
                name="location"
                maxLength={200}
                placeholder="e.g. Production Floor, Sector 2"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="new-machine-notes">
                Notes <span className="muted">(optional)</span>
              </label>
              <textarea
                id="new-machine-notes"
                name="notes"
                rows={3}
                maxLength={2000}
                placeholder="e.g. Main water supply pump"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div className="actions wizard-actions">
              <button type="button" className="button-secondary" onClick={() => setStep(1)} disabled={saving}>
                Back
              </button>
              <button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> Creating…
                  </>
                ) : (
                  "Create machine"
                )}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
