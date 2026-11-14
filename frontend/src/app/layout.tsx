import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Serif } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import { INTRO_SCRIPT } from "@/lib/intro";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Self-hosted at build time by next/font; no request to Google at runtime.
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

// Display serif, used only for the italic accent word in large headlines.
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  variable: "--font-serif",
  display: "swap",
});

// Absolute URLs for social cards come from the deployed origin; locally the
// default is the dev server.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Sonovate — Acoustic Machine Monitoring", template: "%s · Sonovate" },
  description:
    "Acoustic anomaly screening for bearings and gearboxes: compare new machine recordings with each machine's own normal sound (research prototype).",
  applicationName: "Sonovate",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Browser chrome colour; dark is the default theme.
  themeColor: "#101112",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is the server default; the inline script replaces it with the
    // stored choice before first paint (hence suppressHydrationWarning).
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable} ${serif.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: INTRO_SCRIPT }} />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
