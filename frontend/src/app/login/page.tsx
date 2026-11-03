"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Brand } from "@/components/Brand";
import { ErrorMessage } from "@/components/Status";
import { Turnstile } from "@/components/Turnstile";
import { isGoogleSignInEnabled, signIn, signInWithGoogle, signUp, TURNSTILE_SITE_KEY } from "@/lib/api";

// Decorative trace for the brand panel: a fixed, deterministic signal
// (a few sines under a slow envelope). It is not data and is hidden from
// assistive technology.
const TRACE = (() => {
  const points: string[] = [];
  for (let i = 0; i <= 400; i++) {
    const t = i / 400;
    const envelope = 0.35 + 0.65 * Math.sin(Math.PI * t) ** 2;
    const y =
      Math.sin(t * 2 * Math.PI * 9) * 0.55 +
      Math.sin(t * 2 * Math.PI * 23 + 1.3) * 0.3 +
      Math.sin(t * 2 * Math.PI * 61 + 0.4) * 0.15;
    points.push(`${(t * 800).toFixed(1)},${(55 - y * envelope * 42).toFixed(1)}`);
  }
  return `M${points.join(" L")}`;
})();

export default function LoginPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const handleCaptchaError = useCallback((message: string) => setError(message), []);

  useEffect(() => {
    if (session) router.replace("/machines");
  }, [session, router]);

  useEffect(() => {
    isGoogleSignInEnabled().then(setGoogleEnabled);
  }, []);

  async function handleGoogle() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle(); // navigates away on success
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Google sign-in.");
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setError("Complete the security check first.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "sign-in") {
        await signIn(email, password, captchaToken ?? undefined);
      } else {
        const { needsConfirmation } = await signUp(email, password, captchaToken ?? undefined);
        if (needsConfirmation) setInfo("Check your email to confirm your account, then sign in.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
      // Tokens are single use; a failed or repeated attempt needs a new one.
      if (TURNSTILE_SITE_KEY) setCaptchaReset((n) => n + 1);
    }
  }

  const title = mode === "sign-in" ? "Sign in" : "Create an account";

  return (
    <div className="auth-layout">
      <aside className="auth-panel" aria-label="About Sonovate">
        <Brand href="/login" />
        <div>
          <p className="eyebrow">Research prototype</p>
          <h1>Listen for what changed in a machine&apos;s sound.</h1>
          <p>
            Record a bearing or gearbox while it runs normally, then compare new recordings against that baseline. Low
            sensitivity; not a diagnosis or failure prediction.
          </p>
        </div>
        <svg className="auth-trace" viewBox="0 0 800 110" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="55" x2="800" y2="55" strokeWidth="1" />
          <path d={TRACE} pathLength={1} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </aside>

      <main className="auth-form">
        <section className="card" aria-labelledby="auth-title">
          <p className="eyebrow">{mode === "sign-in" ? "Welcome back" : "New account"}</p>
          <h2 id="auth-title" className="auth-title">
            {title}
          </h2>
          <form className="form" onSubmit={handleSubmit} noValidate>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            {info && (
              <div className="notice" role="status">
                {info}
              </div>
            )}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                minLength={10}
                required
              />
              {mode === "sign-up" && <p className="muted small">At least 10 characters.</p>}
            </div>
            {TURNSTILE_SITE_KEY && (
              <Turnstile
                siteKey={TURNSTILE_SITE_KEY}
                resetKey={captchaReset}
                onToken={setCaptchaToken}
                onError={handleCaptchaError}
              />
            )}
            <div className="actions">
              <button type="submit" disabled={busy}>
                {busy ? "Please wait…" : title}
              </button>
              <button
                type="button"
                className="button-link"
                onClick={() => {
                  setMode(mode === "sign-in" ? "sign-up" : "sign-in");
                  setError(null);
                  setInfo(null);
                }}
              >
                {mode === "sign-in" ? "Create an account instead" : "I already have an account"}
              </button>
            </div>
          </form>
          {googleEnabled && (
            <div className="alt-auth">
              <p className="divider">or</p>
              <button type="button" className="button-secondary" onClick={handleGoogle} disabled={busy}>
                Continue with Google
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
