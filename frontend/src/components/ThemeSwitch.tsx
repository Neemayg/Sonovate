"use client";

import { useSyncExternalStore } from "react";
import { readThemeChoice, setThemeChoice, subscribeTheme, type ThemeChoice } from "@/lib/theme";

const LABELS: Record<ThemeChoice, string> = { light: "Light", dark: "Dark", system: "System" };
const ORDER: ThemeChoice[] = ["light", "dark", "system"];

function Icon({ choice }: { choice: ThemeChoice }) {
  const common = { width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": true, focusable: false } as const;
  if (choice === "light")
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  if (choice === "dark")
    return (
      <svg {...common}>
        <path
          d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="1.8" y="2.6" width="12.4" height="8.6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 13.6h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// Light / Dark / System selector. "compact" shows icons only (navigation
// bars); the full variant shows labels (account page). The server render has
// no choice selected; the stored choice appears right after hydration, while
// the page colours are already correct from the inline theme script.
export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const choice = useSyncExternalStore<ThemeChoice | null>(subscribeTheme, readThemeChoice, () => null);
  return (
    <div role="group" aria-label="Colour theme" className={compact ? "theme-switch is-compact" : "theme-switch"}>
      {ORDER.map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={choice === c}
          aria-label={compact ? `${LABELS[c]} theme` : undefined}
          title={compact ? `${LABELS[c]} theme` : undefined}
          className="theme-switch-option"
          onClick={() => setThemeChoice(c)}
        >
          <Icon choice={c} />
          {!compact && <span>{LABELS[c]}</span>}
        </button>
      ))}
    </div>
  );
}
