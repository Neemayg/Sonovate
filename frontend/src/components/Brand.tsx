import Link from "next/link";

// Wordmark: a short waveform glyph and the name in spaced capitals.
export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <g fill="currentColor">
        <rect x="1" y="7" width="2" height="4" rx="1" />
        <rect x="5" y="4" width="2" height="10" rx="1" />
        <rect x="9" y="1" width="2" height="16" rx="1" />
        <rect x="13" y="5" width="2" height="8" rx="1" />
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
