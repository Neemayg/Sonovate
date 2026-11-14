import Link from "next/link";

// Where the user is in Machine → Baselines → Analyse → Results, read from the
// machine's stored recordings and results. Nothing is assumed done.

type Step = { id: "baselines" | "analyse" | "results"; title: string; detail: string; href: string };

export function JourneySteps({
  machineId,
  baselineCount,
  required,
  checksWithResult,
  latestResultId,
  current,
}: {
  machineId: string;
  baselineCount: number;
  required: number;
  checksWithResult: number;
  latestResultId: string | null;
  /** The step this page is about; otherwise the first unfinished step. */
  current?: Step["id"];
}) {
  const baselineDone = baselineCount >= required;
  const analysed = checksWithResult > 0;
  const steps: Step[] = [
    {
      id: "baselines",
      title: "Baselines",
      detail: baselineDone ? `${baselineCount} normal recordings` : `${baselineCount} of ${required} normal recordings`,
      href: `/machines/${machineId}#baseline`,
    },
    {
      id: "analyse",
      title: "Analyse",
      detail: !baselineDone ? "After the baseline" : analysed ? `${checksWithResult} analysed` : "Ready for the first check",
      href: `/machines/${machineId}#check`,
    },
    {
      id: "results",
      title: "Results",
      detail: analysed ? "Review the latest result" : "Appear after a check",
      href: latestResultId ? `/recordings/${latestResultId}` : `/machines/${machineId}#results`,
    },
  ];
  const done = { baselines: baselineDone, analyse: analysed, results: false };
  const next = current ?? (!baselineDone ? "baselines" : !analysed ? "analyse" : "results");
  return (
    <ol className="journey" aria-label="Monitoring steps for this machine">
      {steps.map((s, i) => {
        const state = s.id === next ? "current" : done[s.id] ? "done" : "todo";
        const locked = s.id !== "baselines" && !baselineDone;
        const inner = (
          <>
            <span className="journey-mark num" aria-hidden="true">
              {state === "done" ? "✓" : i + 1}
            </span>
            <span className="journey-text">
              <strong>{s.title}</strong>
              <span className="muted small">{s.detail}</span>
            </span>
            <span className="visually-hidden">
              {state === "done" ? "(done)" : state === "current" ? "(you are here)" : "(not yet)"}
            </span>
          </>
        );
        return (
          <li key={s.id} className={`journey-step is-${state}`} aria-current={state === "current" ? "step" : undefined}>
            {locked || (s.id === "results" && !analysed) ? (
              <span className="journey-link">{inner}</span>
            ) : (
              <Link href={s.href} className="journey-link">
                {inner}
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}
