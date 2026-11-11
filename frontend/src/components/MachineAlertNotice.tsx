import type { MachineAlert } from "@/lib/api";
import { HowAlertsWork } from "./MonitoringStatus";
import { formatDateTime } from "./Status";

// ADR-009: an alert when at least 2 of the last 3 checks are above this
// machine's threshold. The rule itself is unchanged; this only words it.
// A missing alert is never presented as "healthy".
export const ALERT_RULE_NOTE =
  "Alert rule: at least 2 of the last 3 analyses above this machine's baseline threshold. It was chosen on simulated timelines, not real machine histories, and with the current detector it misses most faults.";

type Props = { alert: MachineAlert | null; compact?: boolean };

export function MachineAlertNotice({ alert, compact = false }: Props) {
  if (!alert) return null;
  const counts = `${alert.above_threshold_count} of the last ${alert.analyses_considered} ${
    alert.analyses_considered === 1 ? "check" : "checks"
  }`;

  if (alert.alert) {
    return (
      <div className="notice notice-warning machine-alert" role="status">
        <p>
          <strong>Repeated unusual readings:</strong> {counts} were above this machine&apos;s baseline threshold.
        </p>
        {!compact && (
          <p className="small">
            Inspect the machine and review its recordings. This is not a diagnosis or a failure prediction. Last
            checked {formatDateTime(alert.last_analysed_at)}.
          </p>
        )}
        {!compact && <HowAlertsWork compact />}
      </div>
    );
  }

  return (
    <div className="machine-alert-none">
      <p className="small">
        <strong>No current machine alert</strong> · {counts} above threshold. This does not confirm that the machine
        is fault-free.
      </p>
      {!compact && <HowAlertsWork compact />}
    </div>
  );
}
