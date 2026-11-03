import type { AnalyticsSummary } from "@/lib/analytics/contracts";
import styles from "./analytics.module.css";
export function PerformanceMetrics({
  summary,
  loading,
}: {
  summary?: AnalyticsSummary;
  loading: boolean;
}) {
  const metrics = [
    ["Total attempts", summary?.attempts],
    ["Answered calls", summary?.answered],
    ["No answer", summary?.unanswered],
    ["Voicemails", summary?.voicemails],
    ["Interested prospects", summary?.interested],
    ["Rejected calls", summary?.rejected],
    ["Follow-ups scheduled", summary?.followups],
    ["Meetings booked", summary?.meetings],
    ["Businesses contacted", summary?.businesses_contacted],
    ["Callbacks requested", summary?.callbacks],
    ["Answer rate", summary ? `${summary.answer_rate}%` : undefined],
    [
      "Interest conversion",
      summary ? `${summary.conversion_rate}%` : undefined,
    ],
  ] as const;
  return (
    <>
      <dl
        className={styles.metrics}
        aria-label="Performance in selected period"
        aria-busy={loading}
      >
        {metrics.map(([label, value]) => (
          <div key={label} className={styles.metric}>
            <dt>{label}</dt>
            <dd>{loading || value === undefined ? "—" : value}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.caption}>
        Confirmed attempts only; corrected attempts are excluded. Answer rate =
        answered ÷ attempts. Interest conversion = interested prospects ÷
        distinct businesses contacted. Current lead statuses never rewrite these
        historical outcomes.
      </p>
    </>
  );
}
