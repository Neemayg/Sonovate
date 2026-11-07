"use client";

import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import {
  DashHero,
  Icons,
  KpiTiles,
  MachineFilters,
  matchesFilter,
  ModelPanel,
  NextStepsPanel,
  RecentAnalysesPanel,
  type MachineFilter,
} from "@/components/Dashboard";
import { MachineCard } from "@/components/MachineCard";
import { MachineForm } from "@/components/MachineForm";
import { ErrorMessage } from "@/components/Status";
import {
  checkAnalysisService,
  createMachine,
  getProductModel,
  listMachineOverviews,
  listRecentAnalyses,
  summarise,
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
  const [formOpen, setFormOpen] = useState(false);
  const formRef = useRef<HTMLElement>(null);

  useEffect(() => {
    listMachineOverviews()
      .then((list) => {
        setMachines(list);
        if (list.length === 0) setFormOpen(true);
      })
      .catch((err: Error) => setError(err.message));
    listRecentAnalyses(5)
      .then(setRecent)
      .catch((err: Error) => setRecentError(err.message));
    getProductModel()
      .then(setModel)
      .catch((err: Error) => setModelError(err.message));
    checkAnalysisService().then(setService);
  }, []);

  function openForm() {
    setFormOpen(true);
    // Wait for the panel to render open before scrolling and focusing.
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      formRef.current?.querySelector<HTMLInputElement>("input[name=name]")?.focus({ preventScroll: true });
    });
  }

  const visible = machines?.filter((m) => matchesFilter(m, filter)) ?? [];

  return (
    <div className="dash">
      <DashHero email={session?.user.email} machines={machines} service={service} model={model ?? null} onAdd={openForm} />

      {error && <ErrorMessage>{error}</ErrorMessage>}

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

          {machines?.length === 0 && (
            <div className="card empty-state">
              <div className="empty-mark" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
              <div>
                <p className="empty-title">No machines yet</p>
                <p className="muted">Add a bearing or gearbox, then record its normal sound as a baseline.</p>
                <ol className="empty-steps">
                  <li>Add a machine</li>
                  <li>Upload 10 baseline recordings</li>
                  <li>Upload a new recording to compare</li>
                </ol>
              </div>
            </div>
          )}

          {machines && machines.length > 0 && (
            <ul className="machine-grid" key={filter}>
              {visible.map((m) => (
                <li key={m.id}>
                  <MachineCard machine={m} />
                </li>
              ))}
            </ul>
          )}

          <section
            ref={formRef}
            className={`card add-machine${formOpen ? " is-open" : ""}`}
            aria-labelledby="machine-create-title"
          >
            <button
              type="button"
              className="add-machine-toggle"
              aria-expanded={formOpen}
              aria-controls="machine-create-body"
              onClick={() => setFormOpen((v) => !v)}
            >
              <span className="add-machine-icon" aria-hidden="true">
                {Icons.plus}
              </span>
              <span>
                <span id="machine-create-title" className="add-machine-title">
                  Add a machine
                </span>
                <span className="muted small">Register it, then upload its baseline recordings from its page.</span>
              </span>
              <span className="add-machine-chevron" aria-hidden="true" />
            </button>
            {formOpen && (
              <div id="machine-create-body" className="add-machine-body">
                <MachineForm
                  submitLabel="Add machine"
                  onSubmit={async (input) => {
                    const created = await createMachine(input);
                    setMachines((current) => [summarise(created), ...(current ?? [])]);
                    setFilter("all");
                  }}
                />
              </div>
            )}
          </section>
        </section>

        <aside className="dash-side" aria-label="Activity and model">
          {machines && <NextStepsPanel machines={machines} onAdd={openForm} />}
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
