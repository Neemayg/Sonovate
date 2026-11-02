import type { CSSProperties, ReactNode } from "react";

type Props = {
  count: number;
  required: number;
  /** Text shown under the meter (left); the count is shown on the right. */
  caption?: ReactNode;
  label?: string;
};

// One cell per required baseline recording, filled as they are added.
// Exposed to assistive technology as a progress bar.
export function BaselineMeter({ count, required, caption, label = "Baseline recordings" }: Props) {
  const filled = Math.min(count, required);
  return (
    <div>
      <div
        className="meter"
        style={{ "--cells": required } as CSSProperties}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={required}
        aria-valuenow={filled}
        aria-valuetext={`${filled} of ${required}`}
      >
        {Array.from({ length: required }, (_, i) => (
          <span
            key={i}
            className={`meter-cell${i < filled ? " is-filled" : ""}`}
            style={{ "--i": i } as CSSProperties}
          />
        ))}
      </div>
      <p className="meter-caption">
        <span>{caption}</span>
        <strong>
          {filled}/{required}
        </strong>
      </p>
    </div>
  );
}
