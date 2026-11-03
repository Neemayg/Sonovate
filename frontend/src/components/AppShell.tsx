"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, type ReactNode } from "react";
import { signOut } from "@/lib/api";
import { useAuth } from "./AuthProvider";
import { Brand } from "./Brand";
import { Loading } from "./Status";

function MainNav({ current }: { current?: string }) {
  return (
    <nav aria-label="Main">
      <Link href="/machines" aria-current={current === "/machines" ? "page" : undefined}>
        Machines
      </Link>
      <Link href="/account" aria-current={current === "/account" ? "page" : undefined}>
        Account
      </Link>
    </nav>
  );
}

// The pathname is request-time data, so it is read behind a Suspense
// boundary; the fallback is the same nav without the active marker.
function ActiveMainNav() {
  return <MainNav current={usePathname()} />;
}

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
          <Brand />
          <Suspense fallback={<MainNav />}>
            <ActiveMainNav />
          </Suspense>
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
