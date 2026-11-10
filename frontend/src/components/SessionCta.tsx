"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <path d="M2 7h9M7.5 3.5 11 7l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Calls to action on the public pages. Signed-in visitors go straight to
// their machines; everyone else goes to sign-in or account creation.
export function SessionCta({ variant }: { variant: "nav" | "hero" | "pair" }) {
  const { session, loading } = useAuth();
  const signedIn = !loading && session !== null;

  if (variant === "nav") {
    return signedIn ? (
      <Link href="/machines" className="btn btn-primary btn-sm">
        Open dashboard <Arrow />
      </Link>
    ) : (
      <>
        <Link href="/login" className="btn btn-quiet btn-sm">
          Sign in
        </Link>
        <Link href="/login?mode=sign-up" className="btn btn-primary btn-sm">
          Get started <Arrow />
        </Link>
      </>
    );
  }

  if (signedIn) {
    return (
      <Link href="/machines" className="btn btn-primary btn-lg">
        Open your machines <Arrow />
      </Link>
    );
  }
  return (
    <>
      <Link href="/login?mode=sign-up" className="btn btn-primary btn-lg">
        Create an account <Arrow />
      </Link>
      {variant === "pair" && (
        <Link href="/login" className="btn btn-ghost btn-lg">
          Sign in
        </Link>
      )}
    </>
  );
}
