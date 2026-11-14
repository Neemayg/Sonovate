"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  ActivityPanel,
  DashHeader,
  GettingStarted,
  MachineTable,
  ModelPanel,
  NextStepCard,
  OverviewStrip,
  buildActivity,
} from "@/components/Dashboard";
import { SkeletonBlock } from "@/components/MonitoringStatus";
import { ErrorMessage } from "@/components/Status";
import {
  checkAnalysisService,
  countAnalysesSince,
  getProductModel,
  listAlertEpisodes,
  listMachineOverviews,
  listRecentAnalyses,
  type AlertEpisode,
  type MachineOverview,
  type ModelVersionInfo,
  type RecentAnalysis,
  type ServiceStatus,
} from "@/lib/api";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function Overview() {
  const [machines, setMachines] = useState<MachineOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<{ items: RecentAnalysis[]; total: number } | null>(null);
  const [episodes, setEpisodes] = useState<AlertEpisode[] | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [weekCount, setWeekCount] = useState<number | null>(null);
  const [model, setModel] = useState<ModelVersionInfo | null | undefined>(undefined);
  const [modelError, setModelError] = useState<string | null>(null);
  const [service, setService] = useState<ServiceStatus | "checking">("checking");

  useEffect(() => {
    listMachineOverviews()
      .then(setMachines)
      .catch((err: Error) => setError(err.message));
    Promise.all([listRecentAnalyses(8), listAlertEpisodes(8)])
      .then(([r, e]) => {
        setRecent(r);
        setEpisodes(e);
      })
      .catch((err: Error) => setActivityError(err.message));
    countAnalysesSince(new Date(Date.now() - WEEK_MS).toISOString())
      .then(setWeekCount)
      .catch(() => setWeekCount(null));
    getProductModel()
      .then(setModel)
      .catch((err: Error) => setModelError(err.message));
    checkAnalysisService().then(setService);
  }, []);

  // A brand-new account sees the three first steps instead of an empty
  // dashboard full of zeros.
  if (machines?.length === 0) {
    return (
      <div className="dash">
        <GettingStarted machines={machines} analysesTotal={recent?.total ?? 0} variant="welcome" />
      </div>
    );
  }

  const activity = machines && recent && episodes ? buildActivity(machines, recent.items, episodes) : null;

  return (
    <div className="dash">
      <DashHeader service={service} />

      {error && <ErrorMessage>{error}</ErrorMessage>}

      {!error && machines === null && (
        <div className="card" aria-hidden="true">
          <SkeletonBlock lines={4} />
        </div>
      )}

      {machines && <OverviewStrip machines={machines} recentAnalyses={weekCount} />}

      {machines && <NextStepCard machines={machines} />}

      <div className="dash-grid">
        <section className="dash-main" aria-labelledby="machines-list-title">
          <div className="section-bar">
            <div>
              <h2 id="machines-list-title">Your machines</h2>
              <p className="muted small">Each machine is compared only with its own baseline recordings.</p>
            </div>
          </div>
          {machines && machines.length > 0 && <MachineTable machines={machines} />}
        </section>

        <aside className="dash-side" aria-label="Activity and model">
          <ActivityPanel items={activity} error={activityError} />
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
