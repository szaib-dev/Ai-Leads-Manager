"use client";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { Select } from "@/components/ui/select";
import { useLiveSelection } from "@/lib/realtime/use-live-selection";
import { useState, useSyncExternalStore } from "react";
import {
  ArrowDownUp,
  CalendarDays,
  CheckCheck,
  ListFilter,
} from "lucide-react";
import { useWorkspace } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { LeadDetails } from "@/components/leads/lead-details";
import { AttemptDialog } from "@/components/leads/attempt-dialog";
import { FollowupRow } from "@/components/followups/followup-row";
import { RescheduleDialog } from "@/components/followups/reschedule-dialog";
import { dayInZone } from "@/lib/analytics/contracts";
import { subscribeCalendar } from "@/lib/analytics/use-filters";
import { changeFollowup } from "@/lib/workflows/actions";
import { fetchFollowups } from "@/lib/workflows/browser-reads";
import { useQuery } from "@/lib/workflows/use-query";
import type { FollowupEntry } from "@/lib/leads/workflow-contracts";
import { followupCategory, type FollowupCategory } from "@/types/followup";
import styles from "@/components/followups/followups.module.css";
const categories: {
  id: FollowupCategory;
  label: string;
  summary: string;
}[] = [
  { id: "overdue", label: "Overdue", summary: "Overdue" },
  { id: "today", label: "Today", summary: "Due today" },
  { id: "upcoming", label: "Upcoming", summary: "Upcoming" },
  { id: "completed", label: "Completed", summary: "Completed" },
];
const emptyDescriptions: Record<FollowupCategory | "all", string> = {
  all: "Schedule a follow-up when you record a call outcome.",
  overdue: "No overdue follow-ups. Your pending conversations are on schedule.",
  today:
    "Nothing scheduled for today. Check Upcoming for your next conversations.",
  upcoming:
    "No future follow-ups yet. Reschedule a task or set a date when recording an outcome.",
  completed:
    "Record an outcome to move a follow-up here. Completed tasks stay available for reference.",
};
export function Followups() {
  const { pages, refreshPages, toast, timezone } = useWorkspace();
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [optimisticComplete, setOptimisticComplete] = useLiveSelection<
    string | null
  >(null);
  const today = useSyncExternalStore(
    subscribeCalendar,
    () => dayInZone(timezone),
    () => dayInZone(timezone),
  );
  const [tab, setTab] = useState<FollowupCategory | "all">("all");
  const [sort, setSort] = useState("asc");
  const [selectedId, setSelectedId] = useLiveSelection<string | null>(null);
  const [attemptId, setAttemptId] = useLiveSelection<string | null>(null);
  const [rescheduleId, setRescheduleId] = useLiveSelection<string | null>(null);
  const q = useQuery(JSON.stringify(["followups",today, tab, sort, page]), () =>
    fetchFollowups(today, tab, sort, page),
  );
  if (!q.loading && q.data && page > Math.max(1, Math.ceil(q.data.total / 20)))
    setPage(Math.max(1, Math.ceil(q.data.total / 20)));
  const tasks = q.data?.rows || [];
  const counts = q.data?.counts || {
    all: 0,
    overdue: 0,
    today: 0,
    upcoming: 0,
    completed: 0,
  };
  const visibleTasks = tasks.map((t) =>
    t.id === optimisticComplete
      ? { ...t, completed: true, category: "completed" as const }
      : t,
  );
  const selectedTask = tasks.find((t) => t.id === selectedId);
  const selected = selectedTask?.lead;
  const attemptTask = tasks.find((t) => t.id === attemptId);
  const rescheduleTask = tasks.find((t) => t.id === rescheduleId);
  async function complete(task: FollowupEntry) {
    setBusy(true);
    setOptimisticComplete(task.id);
    try {
      const r = await changeFollowup({
        leadId: task.lead.id,
        expected: task.lead.updatedAt!,
        requestId: crypto.randomUUID(),
        id: task.id,
        action: "complete",
      });
      if (r.error) toast(r.error);
      else {
        await refreshPages();
        toast("Follow-up completed · no call attempt added");
      }
    } catch {
      toast("Could not complete follow-up. Reload before retrying.");
    } finally {
      setBusy(false);
      setOptimisticComplete(null);
    }
  }
  const filterOptions = [
    { id: "all" as const, label: "All", count: counts.all },
    ...categories.map((category) => ({
      ...category,
      count: counts[category.id],
    })),
  ];
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Follow-ups</h1>
          <p>Keep track of your upcoming conversations.</p>
        </div>
        <span className={styles.sampleDate}>
          <CalendarDays size={14} />
          {new Date(`${today}T12:00:00Z`).toLocaleDateString(undefined, {
            timeZone: "UTC",
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
          <span>{timezone} · dates as entered</span>
        </span>
      </header>
      <dl className={styles.summary}>
        {[categories[1], categories[0], categories[2], categories[3]].map(
          (category) => (
            <div
              key={category.id}
              className={
                category.id === "overdue" && counts.overdue
                  ? styles.overdueCounter
                  : ""
              }
            >
              <dt>{category.summary}</dt>
              <dd>{q.loading || !q.data ? "—" : counts[category.id]}</dd>
            </div>
          ),
        )}
      </dl>
      <div className={styles.toolbar}>
        <div
          className={styles.desktopTabs}
          role="group"
          aria-label="Follow-up category"
        >
          {filterOptions.map((option) => (
            <button
              key={option.id}
              aria-pressed={tab === option.id}
              onClick={() => {
                setTab(option.id);
                setPage(1);
              }}
              className={tab === option.id ? styles.activeTab : ""}
            >
              {option.label}
              <span>{option.count}</span>
            </button>
          ))}
        </div>
        <label className={styles.mobileCategory}>
          <ListFilter size={15} />
          <Select
            variant="plain"
            aria-label="Follow-up category"
            value={tab}
            onValueChange={(value) => (
              setTab(value as FollowupCategory | "all"),
              setPage(1)
            )}
          >
            {filterOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.id === "all" ? "All follow-ups" : option.label} (
                {option.count})
              </option>
            ))}
          </Select>
        </label>
        <label className={styles.sort}>
          <ArrowDownUp size={14} />
          <Select
            variant="plain"
            aria-label="Sort follow-ups by date"
            value={sort}
            onValueChange={(value) => {
              setSort(value);
              setPage(1);
            }}
          >
            <option value="asc">Soonest first</option>
            <option value="desc">Latest first</option>
          </Select>
        </label>
      </div>
      <div className={styles.list}>
        {!q.loading &&
          !q.error &&
          categories
            .filter((category) => tab === "all" || tab === category.id)
            .map((category) => {
              const group = visibleTasks.filter(
                (task) => followupCategory(task, today) === category.id,
              );
              if (!group.length) return null;
              return (
                <section
                  key={category.id}
                  className={styles.group}
                  aria-labelledby={`group-${category.id}`}
                >
                  <div className={styles.groupHeader}>
                    <span
                      className={`${styles.groupDot} ${category.id === "overdue" ? styles.overdueDot : category.id === "completed" ? styles.completedDot : ""}`}
                    />
                    <h2 id={`group-${category.id}`}>{category.label}</h2>
                    <span className={styles.groupCount}>{group.length}</span>
                    {category.id === "overdue" && (
                      <span className={styles.groupHint}>
                        Needs your attention
                      </span>
                    )}
                    {category.id === "completed" && (
                      <CheckCheck size={14} className={styles.groupHint} />
                    )}
                  </div>
                  <div className={styles.groupRows}>
                    {group.map((task) => {
                      const lead = task.lead;
                      return (
                        <FollowupRow
                          key={task.id}
                          task={task}
                          lead={lead}
                          country={
                            pages.find((page) => page.id === lead.pageId)
                              ?.name || "Custom page"
                          }
                          category={category.id}
                          onDetails={() => setSelectedId(task.id)}
                          onOutcome={() => setAttemptId(task.id)}
                          onReschedule={() => setRescheduleId(task.id)}
                          onComplete={() => void complete(task)}
                          busy={busy}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}
        {q.loading && (
          <ListSkeleton rows={3}/>
        )}
        {q.error && (
          <EmptyState
            title="Could not load follow-ups"
            description={q.error}
            action={<Button onClick={q.retry}>Retry</Button>}
          />
        )}
        {!q.loading && !q.error && !visibleTasks.length && (
          <div className={styles.empty}>
            <EmptyState
              title={
                tab === "overdue"
                  ? "You’re all caught up"
                  : "No follow-ups here"
              }
              description={emptyDescriptions[tab]}
              action={
                tab !== "all" ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setTab("all");
                      setPage(1);
                    }}
                  >
                    View all follow-ups
                  </Button>
                ) : undefined
              }
            />
          </div>
        )}
      </div>
      <div className={styles.listFooter}>
        <span>
          {q.data?.total ?? 0}{" "}
          {visibleTasks.length === 1 ? "follow-up" : "follow-ups"}
          {tab === "all"
            ? " across all categories"
            : ` · ${categories.find((category) => category.id === tab)?.label}`}
        </span>
        <span>Saved in Supabase · dates as entered</span>
      </div>
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
      {selected && (
        <LeadDetails
          key={selected.id}
          lead={{
            ...selected,
            followup: selectedTask?.date,
            followupTime: selectedTask?.time,
          }}
          real
          onSaved={() => {
            setSelectedId(null);
            void refreshPages();
          }}
          onClose={() => setSelectedId(null)}
          onAttempt={() => {
            setSelectedId(null);
            if (selectedTask) setAttemptId(selectedTask.id);
          }}
        />
      )}
      <AttemptDialog
        key={attemptId}
        lead={attemptTask?.lead ?? null}
        followupId={attemptTask?.id}
        onClose={() => setAttemptId(null)}
        onRecorded={q.retry}
      />
      {rescheduleTask && (
        <RescheduleDialog
          key={rescheduleTask.id}
          task={rescheduleTask}
          lead={rescheduleTask.lead}
          onSaved={q.retry}
          onClose={() => setRescheduleId(null)}
        />
      )}
    </div>
  );
}
