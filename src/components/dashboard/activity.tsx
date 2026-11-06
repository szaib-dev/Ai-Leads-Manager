"use client";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { useLiveSelection } from "@/lib/realtime/use-live-selection";
import { useState } from "react";
import { CheckCheck, Phone, TrendingUp } from "lucide-react";
import { useWorkspace } from "@/components/providers";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { LeadDetails } from "@/components/leads/lead-details";
import { AttemptDialog } from "@/components/leads/attempt-dialog";
import { fetchLeadRecord } from "@/lib/workflows/actions";
import { useQuery } from "@/lib/workflows/use-query";
import { outcomeLabels } from "@/lib/leads/workflow-contracts";
import styles from "./activity.module.css";
import { fromDb } from "@/lib/leads/contracts";
import { fetchActivityRange } from "@/lib/analytics/actions";
import { useAnalyticsFilters } from "@/lib/analytics/use-filters";
import { formatMoment } from "@/lib/analytics/contracts";
import { AnalyticsControls } from "@/components/analytics/analytics-controls";
import { PerformanceMetrics } from "@/components/analytics/performance-metrics";
import type { Lead } from "@/types";
export function ActivityPage() {
  const { refreshPages, toast, timezone } = useWorkspace();
  const filters = useAnalyticsFilters();
  const [page, setPage] = useState(1),
    [selected, setSelected] = useLiveSelection<Lead | null>(null),
    [attempt, setAttempt] = useLiveSelection<Lead | null>(null);
  const q = useQuery(JSON.stringify(["activity",filters.filter, page]), () =>
    fetchActivityRange(filters.filter, page),
  );
  if (!q.loading && q.data && page > Math.max(1, Math.ceil(q.data.total / 20)))
    setPage(Math.max(1, Math.ceil(q.data.total / 20)));
  const list = q.data?.rows || [],
    summary = q.data?.summary;
  async function open(id: string) {
    const r = await fetchLeadRecord(id);
    if (r.data) setSelected(r.data);
    else toast(r.error);
  }
  return (
    <>
      <PageHeader
        eyebrow="ONE CALL AT A TIME"
        title="Your work, in perspective."
        description="Recorded calls, outcomes, and notes in your selected timezone."
      />
      <AnalyticsControls state={filters} onChanged={() => setPage(1)} />
      <div className="activity-stats">
        {[
          {
            label: "Calls attempted",
            value: summary?.attempts ?? 0,
            icon: Phone,
          },
          {
            label: "Conversations",
            value: summary?.answered ?? 0,
            icon: TrendingUp,
          },
          {
            label: "Meetings booked",
            value: summary?.meetings ?? 0,
            icon: CheckCheck,
          },
        ].map((s) => (
          <div className="panel" key={s.label}>
            <s.icon size={19} />
            <span>{s.label}</span>
            <strong>{q.loading || !summary ? "—" : s.value}</strong>
          </div>
        ))}
      </div>
      <PerformanceMetrics summary={summary} loading={q.loading} />
      <section className="panel activity-history">
        <div className="panel-heading">
          <div>
            <h2>Calling history</h2>
            <p className="small muted">
              {filters.range.from} – {filters.range.to} ·{" "}
              {summary?.attempts ?? 0} counted attempts · {timezone}
            </p>
          </div>
          <span className="count-pill">Call attempts</span>
        </div>
        {q.loading ? (
          <ListSkeleton rows={3}/>
        ) : q.error ? (
          <EmptyState
            title="Could not load activity"
            description={q.error}
            action={<Button onClick={q.retry}>Retry</Button>}
          />
        ) : list.length ? (
          <div className={styles.list}>
            {list.map((a) => (
              <article className={styles.row} key={a.id}>
                <time
                  dateTime={a.occurred_at}
                  style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}
                >
                  {formatMoment(a.occurred_at, timezone)}
                </time>
                <div className={styles.content}>
                  <div>
                    {a.lead_id ? (
                      <button
                        className="text-link"
                        style={{ textAlign: "left" }}
                        onClick={() => void open(a.lead_id!)}
                      >
                        {a.business_name}
                      </button>
                    ) : (
                      <strong>Removed business</strong>
                    )}
                    {a.outcome && (
                      <StatusBadge
                        label={outcomeLabels[a.outcome] || "Other"}
                        status={
                          fromDb({
                            status:
                              a.outcome === "callback_requested"
                                ? "follow_up"
                                : a.outcome,
                          }).status
                        }
                      />
                    )}
                  </div>
                  <span className="small muted">
                    {a.attempt_number
                      ? `Attempt #${a.attempt_number}`
                      : "Recorded call"}
                    {a.voided_at ? " · Corrected — excluded from totals" : ""}
                  </span>
                  {a.notes &&
                    (a.notes.length > 180 ? (
                      <details className={styles.notes}>
                        <summary>Notes · {a.notes.slice(0, 110)}…</summary>
                        <p
                          style={{
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {a.notes}
                        </p>
                      </details>
                    ) : (
                      <p
                        style={{
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {a.notes}
                      </p>
                    ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="A quiet day on the calling desk."
            description="No calls recorded for this date. Confirm a call attempt to start your history."
          />
        )}
        {(q.data?.total ?? 0) > 20 && (
          <div className="dialog-actions">
            <Button
              variant="outline"
              disabled={page === 1 || q.loading}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span className="small muted">Page {page}</span>
            <Button
              variant="outline"
              disabled={page * 20 >= (q.data?.total ?? 0) || q.loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </section>
      {selected && (
        <LeadDetails
          key={selected.id}
          lead={selected}
          real
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            void refreshPages();
          }}
          onAttempt={(freshLead) => {
            setAttempt(freshLead);
            setSelected(null);
          }}
        />
      )}
      {attempt && (
        <AttemptDialog
          key={attempt.id}
          lead={attempt}
          onClose={() => setAttempt(null)}
          onRecorded={q.retry}
        />
      )}
    </>
  );
}
