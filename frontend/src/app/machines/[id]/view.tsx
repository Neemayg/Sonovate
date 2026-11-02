"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BaselineMeter } from "@/components/BaselineMeter";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { MachineForm } from "@/components/MachineForm";
import { PageHead } from "@/components/PageHead";
import { Empty, ErrorMessage, Loading, formatDateTime } from "@/components/Status";
import { UploadForm } from "@/components/UploadForm";
import {
  BASELINE_REQUIRED,
  deleteMachine,
  getMachine,
  listRecordings,
  updateMachine,
  type Machine,
  type Recording,
} from "@/lib/api";
import { MODEL_INPUTS, machineTypeLabel } from "@/lib/modelInputs";

export function MachineDetail({ id }: { id: string }) {
  const router = useRouter();
  const [machine, setMachine] = useState<Machine | null | undefined>(undefined);
  const [recordings, setRecordings] = useState<Recording[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [lastBaseline, setLastBaseline] = useState<string | null>(null);

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

  const modelled = MODEL_INPUTS[machine.machine_type].length > 0;
  const baselineCount = (recordings ?? []).filter((r) => r.kind === "baseline").length;
  const baselineReady = baselineCount >= BASELINE_REQUIRED;

  return (
    <>
      <PageHead
        crumbs={[{ href: "/machines", label: "Machines" }]}
        eyebrow={[machineTypeLabel(machine.machine_type), machine.location].filter(Boolean).join(" · ")}
        title={machine.name}
        meta={`${recordings?.length ?? 0} ${recordings?.length === 1 ? "recording" : "recordings"}`}
        actions={
          <Link href={`/machines/${machine.id}/history`} className="button-like">
            History
          </Link>
        }
      />

      <div className="columns">
        <div>
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

          {modelled && (
            <section className="card" aria-labelledby="baseline-title">
              <h2 id="baseline-title">Baseline</h2>
              <p>
                Results compare a recording with this machine&apos;s own normal sound. Upload at least{" "}
                {BASELINE_REQUIRED} baseline recordings, made while the machine runs normally, before analysing.
              </p>
              <BaselineMeter
                count={baselineCount}
                required={BASELINE_REQUIRED}
                caption={
                  baselineReady
                    ? `Ready for analysis${baselineCount > BASELINE_REQUIRED ? ` · ${baselineCount} in total` : ""}`
                    : `${BASELINE_REQUIRED - baselineCount} more needed`
                }
              />
              {lastBaseline && (
                <p className="muted small" role="status">
                  Saved {lastBaseline} as a baseline recording.
                </p>
              )}
              <p className="muted small">
                Adding or removing a baseline recording changes the threshold used for the next analysis.
              </p>
            </section>
          )}
        </div>
        <section className="card" aria-labelledby="upload-title">
          <h2 id="upload-title">Upload a recording</h2>
          <UploadForm
            key={`${machine.machine_type}-${baselineReady}`}
            machineId={machine.id}
            machineType={machine.machine_type}
            defaultKind={modelled && !baselineReady ? "baseline" : "analysis"}
            onUploaded={(r) => {
              if (r.kind === "baseline") {
                // Stay here so several baseline recordings can be added in a row.
                setRecordings((current) => [r, ...(current ?? [])]);
                setLastBaseline(r.original_filename ?? "the recording");
              } else {
                router.push(`/recordings/${r.id}`);
              }
            }}
          />
        </section>
      </div>

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

      <section className="card danger-zone" aria-labelledby="delete-machine-title">
        <h2 id="delete-machine-title">Danger zone</h2>
        <ConfirmDelete
          label="Delete machine"
          confirmText={machine.name}
          onConfirm={async () => {
            await deleteMachine(machine.id);
            router.replace("/machines");
          }}
        >
          <p>
            This deletes {machine.name} and everything under it: {recordings?.length ?? 0}{" "}
            {recordings?.length === 1 ? "recording" : "recordings"} with their audio files, operating context, analysis
            results and baseline threshold.
          </p>
        </ConfirmDelete>
      </section>
    </>
  );
}
