"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ErrorMessage } from "@/components/Status";
import { isGoogleSignInEnabled, signIn, signInWithGoogle, signUp } from "@/lib/api";

export default function LoginPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

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
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "sign-in") {
        await signIn(email, password);
      } else {
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) setInfo("Check your email to confirm your account, then sign in.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "sign-in" ? "Sign in" : "Create an account";

  return (
    <main className="container narrow">
      <h1>Sonovate</h1>
      <section className="card" aria-labelledby="auth-title">
        <h2 id="auth-title">{title}</h2>
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
            <p className="muted small">or</p>
            <button type="button" className="button-secondary" onClick={handleGoogle} disabled={busy}>
              Continue with Google
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
