"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Brand } from "@/components/Brand";
import { ErrorMessage, Loading } from "@/components/Status";

// Google (via Supabase Auth) redirects here with ?code=... on success or
// ?error=...&error_description=... on failure. The Supabase client exchanges
// the code for a session on load; this page waits for it, then moves on.
export default function AuthCallbackPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [providerError, setProviderError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const description = params.get("error_description") ?? hash.get("error_description");
    if (description || params.get("error") || hash.get("error")) {
      // Reading the URL once on mount; there is no external store to subscribe to.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProviderError(description ?? "Sign-in was cancelled or failed.");
    }
  }, []);

  useEffect(() => {
    if (session) router.replace("/machines");
  }, [session, router]);

  const failed = providerError !== null || (!loading && !session);

  return (
    <main className="container narrow">
      <p style={{ margin: "1rem 0 1.5rem" }}>
        <Brand href="/login" />
      </p>
      <h1 className="visually-hidden">Finishing sign-in</h1>
      {failed ? (
        <>
          <ErrorMessage>{providerError ?? "Google sign-in did not complete. Please try again."}</ErrorMessage>
          <p>
            <Link href="/login">Back to sign in</Link>
          </p>
        </>
      ) : (
        <Loading label="Finishing sign-in…" />
      )}
    </main>
  );
}
