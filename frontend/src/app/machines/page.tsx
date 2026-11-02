"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MachineForm } from "@/components/MachineForm";
import { Empty, ErrorMessage, Loading, formatDateTime } from "@/components/Status";
import { createMachine, listMachines, type Machine } from "@/lib/api";
import { machineTypeLabel } from "@/lib/modelInputs";

function MachinesList() {
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMachines()
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
          <ul className="list">
            {machines.map((m) => (
              <li key={m.id}>
                <Link href={`/machines/${m.id}`} className="list-link">
                  <span className="list-title">{m.name}</span>
                  <span className="muted small">
                    {[machineTypeLabel(m.machine_type), m.location].filter(Boolean).join(" · ")}
                    {" · added "}
                    {formatDateTime(m.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="machine-create-title">
        <h2 id="machine-create-title">Add a machine</h2>
        <MachineForm
          submitLabel="Add machine"
          onSubmit={async (input) => {
            const created = await createMachine(input);
            setMachines((current) => [created, ...(current ?? [])]);
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
