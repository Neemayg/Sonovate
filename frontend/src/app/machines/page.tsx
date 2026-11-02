"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MachineCard, machineStatus } from "@/components/MachineCard";
import { MachineForm } from "@/components/MachineForm";
import { Empty, ErrorMessage, Loading } from "@/components/Status";
import { createMachine, listMachineOverviews, summarise, type MachineOverview } from "@/lib/api";

function summaryLine(machines: MachineOverview[]): string {
  const counts = { needs_baseline: 0, ready: 0, has_result: 0, unsupported: 0 };
  for (const m of machines) counts[machineStatus(m)] += 1;
  const parts = [`${machines.length} ${machines.length === 1 ? "machine" : "machines"}`];
  if (counts.needs_baseline)
    parts.push(`${counts.needs_baseline} ${counts.needs_baseline === 1 ? "needs" : "need"} baseline recordings`);
  if (counts.ready) parts.push(`${counts.ready} ready for analysis`);
  if (counts.has_result) parts.push(`${counts.has_result} with results`);
  if (counts.unsupported) parts.push(`${counts.unsupported} without analysis support`);
  return parts.join(" · ");
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
      <h1>Machines</h1>
      <section className="card" aria-labelledby="machines-list-title">
        <h2 id="machines-list-title">Your machines</h2>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        {!error && machines === null && <Loading label="Loading machines…" />}
        {machines?.length === 0 && <Empty>No machines yet. Add your first machine below.</Empty>}
        {machines && machines.length > 0 && (
          <>
            <p className="muted small" role="status">
              {summaryLine(machines)}
            </p>
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

      <section className="card" aria-labelledby="machine-create-title">
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
