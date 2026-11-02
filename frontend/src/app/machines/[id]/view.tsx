"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MachineForm } from "@/components/MachineForm";
import { Empty, ErrorMessage, Loading, formatDateTime } from "@/components/Status";
import { UploadForm } from "@/components/UploadForm";
import { getMachine, listRecordings, updateMachine, type Machine, type Recording } from "@/lib/api";
import { machineTypeLabel } from "@/lib/modelInputs";

export function MachineDetail({ id }: { id: string }) {
  const router = useRouter();
  const [machine, setMachine] = useState<Machine | null | undefined>(undefined);
  const [recordings, setRecordings] = useState<Recording[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    Promise.all([getMachine(id), listRecordings(id)])
      .then(([m, r]) => {
        setMachine(m);
        setRecordings(r);
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (machine === undefined) return <Loading label="Loading machine…" />;
  if (machine === null) {
    return (
      <>
        <ErrorMessage>Machine not found. It may have been removed, or it belongs to another account.</ErrorMessage>
        <p>
          <Link href="/machines">Back to machines</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <p className="breadcrumb">
        <Link href="/machines">Machines</Link> / {machine.name}
      </p>
      <h1>{machine.name}</h1>

      <section className="card" aria-labelledby="machine-details-title">
        <div className="card-header">
          <h2 id="machine-details-title">Details</h2>
          {!editing && (
            <button type="button" className="button-secondary" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
        {editing ? (
          <MachineForm
            initial={machine}
            submitLabel="Save changes"
            onCancel={() => setEditing(false)}
            onSubmit={async (input) => {
              setMachine(await updateMachine(machine.id, input));
              setEditing(false);
            }}
          />
        ) : (
          <dl className="details">
            <dt>Type</dt>
            <dd>{machineTypeLabel(machine.machine_type)}</dd>
            <dt>Location</dt>
            <dd>{machine.location ?? "—"}</dd>
            <dt>Notes</dt>
            <dd>{machine.notes ?? "—"}</dd>
            <dt>Last updated</dt>
            <dd>{formatDateTime(machine.updated_at)}</dd>
          </dl>
        )}
      </section>

      <section className="card" aria-labelledby="upload-title">
        <h2 id="upload-title">Upload a recording</h2>
        <UploadForm
          key={machine.machine_type}
          machineId={machine.id}
          machineType={machine.machine_type}
          onUploaded={(r) => router.push(`/recordings/${r.id}`)}
        />
      </section>

      <section className="card" aria-labelledby="recordings-title">
        <div className="card-header">
          <h2 id="recordings-title">Recordings</h2>
          <Link href={`/machines/${machine.id}/history`}>View history</Link>
        </div>
        {recordings?.length === 0 && <Empty>No recordings for this machine yet.</Empty>}
        {recordings && recordings.length > 0 && (
          <ul className="list">
            {recordings.map((r) => (
              <li key={r.id}>
                <Link href={`/recordings/${r.id}`} className="list-link">
                  <span className="list-title">{r.original_filename ?? "Recording"}</span>
                  <span className="muted small">
                    <span className={`tag tag-${r.kind}`}>{r.kind === "baseline" ? "Baseline" : "Analysis"}</span>{" "}
                    uploaded {formatDateTime(r.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
