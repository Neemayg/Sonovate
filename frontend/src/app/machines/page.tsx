"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import {
  DashHero,
  GettingStarted,
  gettingStartedSteps,
  KpiTiles,
  MachineFilters,
  matchesFilter,
  ModelPanel,
  NextStepsPanel,
  RecentAnalysesPanel,
  type MachineFilter,
} from "@/components/Dashboard";
import { MachineCard } from "@/components/MachineCard";
import { ErrorMessage } from "@/components/Status";
import {
  checkAnalysisService,
  getProductModel,
  listMachineOverviews,
  listRecentAnalyses,
  type MachineOverview,
  type ModelVersionInfo,
  type RecentAnalysis,
  type ServiceStatus,
} from "@/lib/api";

function MachinesSkeleton() {
  return (
    <ul className="machine-grid" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i}>
          <div className="machine-card machine-card-skeleton">
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Overview() {
  const { session } = useAuth();
  const [machines, setMachines] = useState<MachineOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<{ items: RecentAnalysis[]; total: number } | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [model, setModel] = useState<ModelVersionInfo | null | undefined>(undefined);
  const [modelError, setModelError] = useState<string | null>(null);
  const [service, setService] = useState<ServiceStatus | "checking">("checking");
  const [filter, setFilter] = useState<MachineFilter>("all");

  useEffect(() => {
    listMachineOverviews()
      .then(setMachines)
      .catch((err: Error) => setError(err.message));
    listRecentAnalyses(5)
      .then(setRecent)
      .catch((err: Error) => setRecentError(err.message));
    getProductModel()
      .then(setModel)
      .catch((err: Error) => setModelError(err.message));
    checkAnalysisService().then(setService);
  }, []);

  const visible = machines?.filter((m) => matchesFilter(m, filter)) ?? [];

  // A brand-new account sees the three first steps instead of an empty
  // dashboard full of zeros.
  if (machines?.length === 0) {
    return (
      <div className="dash">
        <GettingStarted machines={machines} analysesTotal={recent?.total ?? 0} variant="welcome" />
      </div>
    );
  }

  const setupDone =
    machines && recent ? gettingStartedSteps(machines, recent.total).every((s) => s.state === "done") : true;

  return (
    <div className="dash">
      <DashHero email={session?.user.email} machines={machines} service={service} model={model ?? null} />

      {error && <ErrorMessage>{error}</ErrorMessage>}

      {machines && recent && !setupDone && (
        <GettingStarted machines={machines} analysesTotal={recent.total} variant="strip" />
      )}

      {machines && (
        <KpiTiles
          machines={machines}
          analyses={recent ? { total: recent.total, latest: recent.items[0]?.created_at ?? null } : null}
        />
      )}

      <div className="dash-grid">
        <section className="dash-main" aria-labelledby="machines-list-title">
          <div className="section-bar">
            <div>
              <h2 id="machines-list-title">Your machines</h2>
              <p className="muted small">Each machine is compared only with its own baseline recordings.</p>
            </div>
            {machines && machines.length > 0 && (
              <MachineFilters machines={machines} value={filter} onChange={setFilter} />
            )}
          </div>

          {!error && machines === null && <MachinesSkeleton />}

          {machines && machines.length > 0 && (
            <ul className="machine-grid" key={filter}>
              {visible.map((m) => (
                <li key={m.id}>
                  <MachineCard machine={m} />
                </li>
              ))}
            </ul>
          )}

          <Link href="/machines/new" className="card add-machine add-machine-link">
            <span className="add-machine-toggle">
              <span className="add-machine-icon" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </span>
              <span>
                <span className="add-machine-title">Add a machine</span>
                <span className="muted small">Choose its type, name it, then upload its baseline recordings.</span>
              </span>
            </span>
          </Link>
        </section>

        <aside className="dash-side" aria-label="Activity and model">
          {machines && <NextStepsPanel machines={machines} />}
          <RecentAnalysesPanel items={recent?.items ?? null} error={recentError} />
          <ModelPanel model={model} error={modelError} />
        </aside>
      </div>
    </div>
  );
}

export default function MachinesPage() {
  return (
    <AppShell>
      <Overview />
    </AppShell>
  );
}
