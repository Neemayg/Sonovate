"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BASELINE_RECOMMENDED, BASELINE_REQUIRED } from "@/lib/api";
import type { MachineType } from "@/lib/modelInputs";
import { BaselineUploader } from "./BaselineUploader";
import { CheckUploader } from "./CheckUploader";

export type WorkbenchTab = "baseline" | "check";

// Progress toward the minimum (10, required for results) and the
// recommendation (30). The count always comes from persisted recordings.
export function BaselineProgress({ count }: { count: number }) {
  const cells = Math.max(BASELINE_RECOMMENDED, count);
  const remaining = Math.max(0, BASELINE_REQUIRED - count);
  const ready = remaining === 0;
  return (
    <div className="bprog">
      <dl className="bprog-stats">
        <div>
          <dt>Uploaded</dt>
          <dd className="num">{count}</dd>
        </div>
        <div className={ready ? "is-met" : undefined}>
          <dt>Minimum</dt>
          <dd>
            <span className="num">{BASELINE_REQUIRED}</span>{" "}
            <span className="bprog-sub">{ready ? "reached" : `${remaining} to go`}</span>
          </dd>
        </div>
        <div>
          <dt>Recommended</dt>
          <dd>
            <span className="num">{BASELINE_RECOMMENDED}</span>{" "}
            <span className="bprog-sub">
              {count >= BASELINE_RECOMMENDED ? "reached" : `${BASELINE_RECOMMENDED - count} to go`}
            </span>
          </dd>
        </div>
      </dl>
      <div
        className="meter meter-accent"
        style={{ "--cells": cells } as CSSProperties}
        role="progressbar"
        aria-label="Baseline recordings toward the recommended 30"
        aria-valuemin={0}
        aria-valuemax={BASELINE_RECOMMENDED}
        aria-valuenow={Math.min(count, BASELINE_RECOMMENDED)}
        aria-valuetext={`${count} uploaded; minimum ${BASELINE_REQUIRED}, recommended ${BASELINE_RECOMMENDED}`}
      >
        {Array.from({ length: cells }, (_, i) => (
          <span
            key={i}
            className={`meter-cell${i < count ? " is-filled" : ""}${i === BASELINE_REQUIRED - 1 ? " is-minimum" : ""}`}
            style={{ "--i": i } as CSSProperties}
          />
        ))}
      </div>
      <p className="meter-caption">
        <span>{ready ? "Ready for machine checks" : `${remaining} more needed before the first check`}</span>
        <strong>
          {count}/{BASELINE_RECOMMENDED}
        </strong>
      </p>
    </div>
  );
}

type Props = {
  machineId: string;
  machineName: string;
  machineType: MachineType;
  analysable: boolean;
  baselineCount: number;
  /** Re-reads the machine's recordings from the database. */
  reload: () => Promise<void>;
  initialTab?: WorkbenchTab;
};

// The two upload tasks on a machine page, as separate tabs: building the
// baseline (many files) and running a check (one file, analysed straight away).
export function RecordingWorkbench({
  machineId,
  machineName,
  machineType,
  analysable,
  baselineCount,
  reload,
  initialTab,
}: Props) {
  const [tab, setTab] = useState<WorkbenchTab>(
    initialTab ?? (analysable && baselineCount < BASELINE_REQUIRED ? "baseline" : "check"),
  );
  const sectionRef = useRef<HTMLElement>(null);
  // Remember the count when this page opened, to announce reaching the minimum.
  const [startCount] = useState(baselineCount);
  const reachedMinimum = startCount < BASELINE_REQUIRED && baselineCount >= BASELINE_REQUIRED;

  // Links such as /machines/<id>#check or #baseline open the matching tab.
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash;
      if (h === "#check" || h === "#baseline") {
        setTab(h === "#check" ? "check" : "baseline");
        sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  if (!analysable) {
    return (
      <section ref={sectionRef} id="record" className="card workbench" aria-labelledby="workbench-title">
        <h2 id="workbench-title">Store a recording</h2>
        <p className="muted small">
          Acoustic analysis is not available for this machine category, so recordings are stored for your records
          only. Change the machine type under Details if it is a bearing or gearbox.
        </p>
        <CheckUploader
          machineId={machineId}
          machineType={machineType}
          baselineCount={baselineCount}
          analysable={false}
          onUploaded={() => reload()}
        />
      </section>
    );
  }

  return (
    <section ref={sectionRef} id="record" className="card workbench" aria-labelledby="workbench-title">
      <div className="workbench-head">
        <h2 id="workbench-title" className="visually-hidden">
          Recordings for {machineName}
        </h2>
        <div className="segmented workbench-tabs" role="group" aria-label="Choose what to upload">
          <button type="button" aria-pressed={tab === "baseline"} onClick={() => setTab("baseline")}>
            Add baseline recordings
          </button>
          <button type="button" aria-pressed={tab === "check"} onClick={() => setTab("check")}>
            Run a machine check
          </button>
          <span className="segmented-thumb" data-pos={tab === "baseline" ? "0" : "1"} aria-hidden="true" />
        </div>
      </div>

      {tab === "baseline" ? (
        <div className="workbench-body" key="baseline">
          <h3 className="workbench-title">Establish your machine&apos;s normal sound</h3>
          <p className="workbench-lead">
            Upload recordings captured while your machine is operating normally. Sonovate uses these recordings to
            establish a machine-specific acoustic reference.
          </p>
          <BaselineProgress count={baselineCount} />
          {reachedMinimum && (
            <div className="notice bprog-done" role="status">
              <p>
                <strong>Minimum reached: {BASELINE_REQUIRED} baseline recordings.</strong> {machineName} is ready for
                its first check.
              </p>
              <p className="small">
                You can keep adding recordings up to {BASELINE_RECOMMENDED}. More recordings give the baseline wider
                coverage of normal operation; they are not a guarantee of better fault detection.
              </p>
              <div className="actions">
                <button type="button" className="btn-sm" onClick={() => setTab("check")}>
                  Run the first check
                </button>
              </div>
            </div>
          )}
          {!reachedMinimum && baselineCount >= BASELINE_REQUIRED && baselineCount < BASELINE_RECOMMENDED && (
            <p className="muted small">
              {BASELINE_RECOMMENDED} recordings are recommended for wider coverage of normal operation; this is not a
              guarantee of better fault detection. Adding or removing a baseline changes the threshold used for the
              next check.
            </p>
          )}
          <BaselineUploader
            machineId={machineId}
            machineType={machineType}
            baselineCount={baselineCount}
            onUploaded={() => reload()}
          />
        </div>
      ) : (
        <div className="workbench-body" key="check">
          <h3 className="workbench-title">Run a machine check</h3>
          <p className="workbench-lead">
            Upload a new recording of the machine. Sonovate compares it with this machine&apos;s baseline and shows
            whether it sits above or below its threshold. It is a screening result, not a diagnosis.
          </p>
          <CheckUploader
            machineId={machineId}
            machineType={machineType}
            baselineCount={baselineCount}
            analysable
            onUploaded={() => reload()}
            onNeedBaselines={() => setTab("baseline")}
          />
        </div>
      )}
    </section>
  );
}
