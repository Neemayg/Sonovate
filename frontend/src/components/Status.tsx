import type { ReactNode } from "react";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="status" role="status" aria-live="polite">
      {label}
    </p>
  );
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <div className="notice notice-error" role="alert">
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
