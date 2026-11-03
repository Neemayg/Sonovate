"use client";

import { useEffect, useRef } from "react";

// Cloudflare Turnstile widget for sign-in CAPTCHA. Rendered only when a site
// key is configured; Supabase Auth verifies the token server-side. Tokens are
// single use, so the parent changes `resetKey` after every attempt to get a
// fresh challenge.

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  scriptPromise ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile did not load.")));
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Turnstile did not load."));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function Turnstile({
  siteKey,
  resetKey,
  onToken,
  onError,
}: {
  siteKey: string;
  resetKey: number;
  onToken: (token: string | null) => void;
  onError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    onToken(null);
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId = api.render(container.current, {
          sitekey: siteKey,
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => {
            onToken(null);
            onError("The security check failed. Reload the page and try again.");
          },
        });
      })
      .catch(() => onError("The security check could not load. Check your connection and reload the page."));
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, resetKey, onToken, onError]);

  return <div ref={container} className="captcha" aria-label="Security check" />;
}
