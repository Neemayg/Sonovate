import type { MachineAlert } from "@/lib/api";
import { formatDateTime } from "./Status";

// ADR-009 wording: the rule was chosen on simulated timelines and misses most
// faults with the current detector. A missing alert never means "healthy".
export const ALERT_RULE_NOTE =
  "Alert rule: at least 2 of the last 3 analyses above this machine's baseline threshold. It was chosen on simulated timelines, not real machine histories, and with the current detector it misses most faults.";

type Props = { alert: MachineAlert | null; compact?: boolean };

export function MachineAlertNotice({ alert, compact = false }: Props) {
  if (!alert) return null;
  const counts = `${alert.above_threshold_count} of the last ${alert.analyses_considered} ${
    alert.analyses_considered === 1 ? "analysis" : "analyses"
  }`;

  if (alert.alert) {
    return (
      <div className="notice notice-warning machine-alert" role="status">
        <p>
          <strong>Machine alert:</strong> {counts} were above this machine&apos;s baseline threshold.
        </p>
        {compact ? (
          <p className="small">Simulated-timeline rule; misses most faults. Not a diagnosis.</p>
        ) : (
          <>
            <p className="small">
              Worth checking the machine. This is not a diagnosis or a failure prediction. Last analysed{" "}
              {formatDateTime(alert.last_analysed_at)}.
            </p>
            <p className="small muted">{ALERT_RULE_NOTE}</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="machine-alert-none">
      <p className="small">
        <strong>No machine alert</strong> · {counts} above threshold.
      </p>
      {!compact && (
        <p className="small muted">
          {ALERT_RULE_NOTE} No alert does not mean the machine is free of faults.
        </p>
      )}
    </div>
  );
}
