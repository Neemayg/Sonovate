"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MachineCard, machineStatus } from "@/components/MachineCard";
import { MachineForm } from "@/components/MachineForm";
import { PageHead } from "@/components/PageHead";
import { ErrorMessage, Loading } from "@/components/Status";
import { createMachine, listMachineOverviews, summarise, type MachineOverview } from "@/lib/api";

function summary(machines: MachineOverview[]): { value: number; label: string }[] {
  const counts = { needs_baseline: 0, ready: 0, has_result: 0, unsupported: 0 };
  for (const m of machines) counts[machineStatus(m)] += 1;
  return [
    { value: machines.length, label: machines.length === 1 ? "machine" : "machines" },
    {
      value: counts.needs_baseline,
      label: counts.needs_baseline === 1 ? "needs baseline recordings" : "need baseline recordings",
    },
    { value: counts.ready, label: "ready for analysis" },
    { value: counts.has_result, label: "with results" },
    {
      value: machines.filter((m) => m.alert?.alert).length,
      label: machines.filter((m) => m.alert?.alert).length === 1 ? "machine alert" : "machine alerts",
    },
    { value: counts.unsupported, label: "without analysis support" },
  ].filter((item, i) => i === 0 || item.value > 0);
}

function MachinesList() {
  const [machines, setMachines] = useState<MachineOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMachineOverviews()
      .then(setMachines)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <>
      <PageHead
        eyebrow="Overview"
        title="Machines"
        meta="Each machine is compared only with its own baseline recordings."
      />
      <section aria-labelledby="machines-list-title">
        <h2 id="machines-list-title" className="visually-hidden">
          Your machines
        </h2>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        {!error && machines === null && <Loading label="Loading machines…" />}
        {machines?.length === 0 && (
          <div className="card empty-state">
            <p>
              <strong>No machines yet.</strong>
            </p>
            <p className="muted">Add a bearing or gearbox below, then record its normal sound as a baseline.</p>
          </div>
        )}
        {machines && machines.length > 0 && (
          <>
            <ul className="summary-strip" aria-label="Summary">
              {summary(machines).map((item) => (
                <li key={item.label}>
                  <span className="num">{item.value}</span> {item.label}
                </li>
              ))}
            </ul>
            <ul className="machine-grid">
              {machines.map((m) => (
                <li key={m.id}>
                  <MachineCard machine={m} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card add-machine" aria-labelledby="machine-create-title">
        <h2 id="machine-create-title">Add a machine</h2>
        <MachineForm
          submitLabel="Add machine"
          onSubmit={async (input) => {
            const created = await createMachine(input);
            setMachines((current) => [summarise(created), ...(current ?? [])]);
          }}
        />
      </section>
    </>
  );
}

export default function MachinesPage() {
  return (
    <AppShell>
      <MachinesList />
    </AppShell>
  );
}
