"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, type ReactNode } from "react";
import { signOut } from "@/lib/api";
import { useAuth } from "./AuthProvider";
import { Brand } from "./Brand";
import { Loading } from "./Status";
import { ThemeSwitch } from "./ThemeSwitch";

function MainNav({ current }: { current?: string }) {
  // Machine, recording and history pages all sit under "Machines".
  const inMachines = current?.startsWith("/machines") || current?.startsWith("/recordings");
  return (
    <nav aria-label="Main" className="app-nav">
      <Link href="/machines" aria-current={inMachines ? "page" : undefined}>
        Machines
      </Link>
      <Link href="/guide" aria-current={current === "/guide" ? "page" : undefined}>
        Guide
      </Link>
      <Link href="/account" aria-current={current === "/account" ? "page" : undefined}>
        Account
      </Link>
    </nav>
  );
}

function initials(email: string): string {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase() || "?";
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
      <main className="container session-check">
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
            <ThemeSwitch compact />
            <Link href="/account" className="user-chip" title={session.user.email ?? undefined}>
              <span className="avatar" aria-hidden="true">
                {initials(session.user.email ?? "")}
              </span>
              <span className="user-email">{session.user.email}</span>
            </Link>
            <button
              type="button"
              className="button-secondary btn-sm"
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
