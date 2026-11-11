"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Brand } from "@/components/Brand";
import { ErrorMessage, Loading } from "@/components/Status";
import { updatePassword } from "@/lib/api";

// The password-reset email links here. The Supabase client exchanges the
// one-time code in the URL for a short recovery session on load (PKCE); with
// that session the user can choose a new password. Without one (expired or
// already used link) the page explains how to ask for a new link.
export default function ResetPasswordPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [linkError, setLinkError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (params.get("error") || hash.get("error")) {
      // Reading the URL once on mount; there is no external store to subscribe to.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkError("This reset link has expired or was already used.");
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    if (password.length < 10) {
      setError("Choose a password of at least 10 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set the new password.");
    } finally {
      setBusy(false);
    }
  }

  const noSession = !loading && !session;

  return (
    <main className="container narrow reset-page">
      <p className="reset-brand">
        <Brand href="/" />
      </p>
      <section className="auth-card" aria-labelledby="reset-title">
        <h1 id="reset-title" className="auth-title">
          Choose a new password
        </h1>
        {loading ? (
          <Loading label="Checking your reset link…" />
        ) : done ? (
          <>
            <div className="notice" role="status">
              Your password has been changed. You are signed in.
            </div>
            <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => router.replace("/machines")}>
              Open your machines
            </button>
          </>
        ) : linkError || noSession ? (
          <>
            <ErrorMessage>
              {linkError ?? "This reset link has expired or was already used."} Ask for a new one and use it soon after
              it arrives.
            </ErrorMessage>
            <Link href="/login?mode=reset" className="btn btn-primary btn-block">
              Send a new reset link
            </Link>
          </>
        ) : (
          <form className="form" onSubmit={handleSubmit} noValidate>
            <p className="auth-sub">Signed in with your reset link. Set a new password for your account.</p>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="field">
              <label htmlFor="new-password">New password</label>
              <input
                id="new-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
                aria-describedby="new-password-hint"
              />
              <p id="new-password-hint" className="muted small">
                At least 10 characters.
              </p>
            </div>
            <div className="field">
              <label htmlFor="confirm-password">Repeat the new password</label>
              <input id="confirm-password" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
            </div>
            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
              {busy ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Saving…
                </>
              ) : (
                "Set new password"
              )}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
