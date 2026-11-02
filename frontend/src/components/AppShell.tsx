"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { signOut } from "@/lib/api";
import { useAuth } from "./AuthProvider";
import { Loading } from "./Status";

// Layout for signed-in pages. Redirects to /login when there is no session.
export function AppShell({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  if (loading || !session) {
    return (
      <main className="container">
        <Loading label="Checking your session…" />
      </main>
    );
  }

  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <Link href="/machines" className="brand">
            Sonovate
          </Link>
          <nav aria-label="Main">
            <Link href="/machines">Machines</Link>
          </nav>
          <div className="topbar-user">
            <span className="muted small">{session.user.email}</span>
            <button
              type="button"
              className="button-secondary"
              onClick={async () => {
                await signOut();
                router.replace("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
