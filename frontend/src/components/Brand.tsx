import Link from "next/link";

// The four waveform bars of the mark, in its 18 x 18 viewBox. Shared with the
// landing intro (IntroStage), which assembles the same bars.
export const BRAND_BARS = [
  { x: 1, y: 7, h: 4 },
  { x: 5, y: 4, h: 10 },
  { x: 9, y: 1, h: 16 },
  { x: 13, y: 5, h: 8 },
] as const;
export const BRAND_BAR_WIDTH = 2;

// Wordmark: a short waveform glyph and the name in spaced capitals.
export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <g fill="currentColor">
        {BRAND_BARS.map((b) => (
          <rect key={b.x} x={b.x} y={b.y} width={BRAND_BAR_WIDTH} height={b.h} rx="1" />
        ))}
      </g>
    </svg>
  );
}

export function Brand({ href = "/machines" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="Sonovate home">
      <BrandMark />
      <span aria-hidden="true">SONOVATE</span>
    </Link>
  );
}
