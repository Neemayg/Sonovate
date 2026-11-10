// Decorative signal graphics for the landing and sign-in pages. Every shape is
// computed from fixed formulas (no randomness, no data), so server and client
// render the same markup. All of it is hidden from assistive technology.

import type { CSSProperties } from "react";

// A sum of a few sines under a slow envelope, as an SVG path.
function tracePath(width: number, mid: number, amp: number, steps = 400): string {
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const envelope = 0.35 + 0.65 * Math.sin(Math.PI * t) ** 2;
    const y =
      Math.sin(t * 2 * Math.PI * 9) * 0.55 +
      Math.sin(t * 2 * Math.PI * 23 + 1.3) * 0.3 +
      Math.sin(t * 2 * Math.PI * 61 + 0.4) * 0.15;
    points.push(`${(t * width).toFixed(1)},${(mid - y * envelope * amp).toFixed(1)}`);
  }
  return `M${points.join(" L")}`;
}

export const TRACE = tracePath(800, 55, 42);

// Bar heights in [0.08, 1] from a deterministic mix of sines.
export function barHeights(count: number, seed = 0): number[] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / count;
    const v =
      0.5 +
      0.28 * Math.sin(t * 17 + seed) +
      0.16 * Math.sin(t * 43 + seed * 2.1) +
      0.1 * Math.sin(t * 97 + seed * 0.7);
    const envelope = 0.45 + 0.55 * Math.sin(Math.PI * t) ** 0.8;
    return Math.max(0.08, Math.min(1, v * envelope));
  });
}

export function SignalBars({ count = 72, seed = 0, className = "" }: { count?: number; seed?: number; className?: string }) {
  const heights = barHeights(count, seed);
  return (
    <div className={`signal-bars ${className}`} aria-hidden="true">
      {heights.map((h, i) => (
        <span
          key={i}
          style={{ "--h": h.toFixed(3), "--i": i } as CSSProperties}
        />
      ))}
    </div>
  );
}

export function SignalTrace({ className = "" }: { className?: string }) {
  return (
    <svg className={`signal-trace ${className}`} viewBox="0 0 800 110" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="55" x2="800" y2="55" strokeWidth="1" />
      <path d={TRACE} pathLength={1} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
