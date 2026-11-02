"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { ErrorMessage } from "./Status";

type Props = {
  /** Text on the first button, e.g. "Delete recording". */
  label: string;
  /** What will be lost; shown before the final confirmation. */
  children: ReactNode;
  /** When set, the user must type this exactly before deleting. */
  confirmText?: string;
  onConfirm: () => Promise<void>;
};

// Two-step delete: the first button only reveals the warning; nothing is
// deleted until the second, explicit button is pressed.
export function ConfirmDelete({ label, children, confirmText, onConfirm }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const openButton = useRef<HTMLButtonElement>(null);

  const ready = !confirmText || typed === confirmText;

  function close() {
    setOpen(false);
    setTyped("");
    setError(null);
    openButton.current?.focus();
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button ref={openButton} type="button" className="button-danger-outline" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return (
    <div className="confirm-delete" role="group" aria-label={`Confirm: ${label}`}>
      <p>
        <strong>{label}?</strong> This cannot be undone.
      </p>
      <div className="small">{children}</div>
      {confirmText && (
        <div className="field">
          <label htmlFor={`${uid}-confirm`}>
            Type <strong>{confirmText}</strong> to confirm
          </label>
          <input
            id={`${uid}-confirm`}
            value={typed}
            autoComplete="off"
            autoFocus
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="actions">
        <button type="button" className="button-danger" onClick={confirm} disabled={!ready || busy}>
          {busy ? "Deleting…" : `Yes, ${label.toLowerCase()}`}
        </button>
        <button type="button" className="button-secondary" onClick={close} disabled={busy} autoFocus={!confirmText}>
          Cancel
        </button>
      </div>
    </div>
  );
}
