"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Brand } from "@/components/Brand";
import { SignalBars, SignalTrace } from "@/components/Decor";
import { ErrorMessage } from "@/components/Status";
import { Turnstile } from "@/components/Turnstile";
import { isGoogleSignInEnabled, requestPasswordReset, signIn, signInWithGoogle, signUp, TURNSTILE_SITE_KEY } from "@/lib/api";

type Mode = "sign-in" | "sign-up" | "reset";

const PANEL_POINTS = [
  "Each machine is compared only with its own normal recordings.",
  "Record with a phone: audio and video are converted in your browser.",
  "Your machines, recordings and results are visible only to you.",
];

function initialMode(value: string | null): Mode {
  return value === "sign-up" ? "sign-up" : value === "reset" ? "reset" : "sign-in";
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d="M1.8 10S4.8 4.5 10 4.5 18.2 10 18.2 10 15.2 15.5 10 15.5 1.8 10 1.8 10Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {!open && <path d="M3.5 16.5 16.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  );
}

function AuthForm() {
  const { session } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(initialMode(params.get("mode")));
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setError(null);
    setInfo(null);
  }

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
    if (!email || (mode !== "reset" && !password)) {
      setError(mode === "reset" ? "Enter the email address of your account." : "Enter your email and password.");
      return;
    }
    if (mode === "sign-up" && password.length < 10) {
      setError("Choose a password of at least 10 characters.");
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
      if (mode === "reset") {
        await requestPasswordReset(email, captchaToken ?? undefined);
        setInfo("If an account exists for that email, a link to set a new password is on its way. It expires after a while, so use it soon.");
      } else if (mode === "sign-in") {
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

  const signingIn = mode === "sign-in";
  const resetting = mode === "reset";
  const title = resetting ? "Reset your password" : signingIn ? "Welcome back" : "Create your account";
  const action = resetting ? "Send reset link" : signingIn ? "Sign in" : "Create account";

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      {!resetting && (
        <div className="segmented" role="group" aria-label="Choose sign in or create an account">
          <button type="button" aria-pressed={signingIn} onClick={() => switchMode("sign-in")}>
            Sign in
          </button>
          <button type="button" aria-pressed={!signingIn} onClick={() => switchMode("sign-up")}>
            Create account
          </button>
          <span className="segmented-thumb" data-pos={signingIn ? "0" : "1"} aria-hidden="true" />
        </div>
      )}

      <h1 id="auth-title" className="auth-title">
        {title}
      </h1>
      <p className="auth-sub">
        {resetting
          ? "Enter your account's email and we will send you a link to choose a new password."
          : signingIn
            ? "Sign in to see your machines and their latest checks."
            : "Create an account, then register your first machine and record its normal sound."}
      </p>

      {googleEnabled && !resetting && (
        <>
          <button type="button" className="btn btn-outline btn-block" onClick={handleGoogle} disabled={busy}>
            <GoogleMark /> Continue with Google
          </button>
          <p className="divider">or with email</p>
        </>
      )}

      <form className="form" onSubmit={handleSubmit} noValidate>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        {info && (
          <div className="notice" role="status">
            {info}
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
        </div>
        {!resetting && (
        <div className="field">
          <div className="field-label-row">
            <label htmlFor="password">Password</label>
            {signingIn && (
              <button type="button" className="button-link small" onClick={() => switchMode("reset")}>
                Forgot password?
              </button>
            )}
          </div>
          <div className="input-affix">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={signingIn ? "current-password" : "new-password"}
              minLength={10}
              aria-describedby={signingIn ? undefined : "password-hint"}
              required
            />
            <button
              type="button"
              className="affix-button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              aria-controls="password"
              onClick={() => setShowPassword((v) => !v)}
            >
              <EyeIcon open={showPassword} />
            </button>
          </div>
          {!signingIn && (
            <p id="password-hint" className="muted small">
              At least 10 characters.
            </p>
          )}
        </div>
        )}
        {TURNSTILE_SITE_KEY && (
          <Turnstile
            siteKey={TURNSTILE_SITE_KEY}
            resetKey={captchaReset}
            onToken={setCaptchaToken}
            onError={handleCaptchaError}
          />
        )}
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
          {busy ? (
            <>
              <span className="spinner" aria-hidden="true" /> Please wait…
            </>
          ) : (
            action
          )}
        </button>
      </form>

      <p className="auth-switch">
        {resetting ? "Remembered it?" : signingIn ? "New to Sonovate?" : "Already have an account?"}{" "}
        <button
          type="button"
          className="button-link"
          onClick={() => switchMode(resetting ? "sign-in" : signingIn ? "sign-up" : "sign-in")}
        >
          {resetting ? "Back to sign in" : signingIn ? "Create an account" : "Sign in instead"}
        </button>
      </p>
    </section>
  );
}

export default function LoginPage() {
  return (
    <div className="auth-layout">
      <aside className="auth-panel theme-dark" aria-label="About Sonovate">
        <div className="hero-glow auth-glow" aria-hidden="true" />
        <div className="hero-grid-bg" aria-hidden="true" />
        <Brand href="/" />
        <div className="auth-panel-copy">
          <p className="pill">
            <span className="pill-dot" aria-hidden="true" />
            Research prototype
          </p>
          <h2>
            Every machine has a sound. <em>Know when it changes.</em>
          </h2>
          <ul className="auth-points">
            {PANEL_POINTS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        <div className="auth-visual">
          <SignalBars count={64} seed={1.7} />
          <SignalTrace className="auth-trace" />
          <p className="auth-footnote">Low sensitivity. Not a diagnosis or failure prediction.</p>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-topline">
          <Link href="/" className="back-link">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
              <path d="M12 7H3M6.5 3.5 3 7l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to home
          </Link>
        </div>
        <div className="auth-center">
          <Suspense fallback={<div className="auth-card auth-card-skeleton skeleton" aria-hidden="true" />}>
            <AuthForm />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
