"use client";
import { DailyDiscipline } from "./daily-discipline";
import Link from "next/link";

import { fetchAnalytics } from "@/lib/analytics/actions";
import { useAnalyticsFilters } from "@/lib/analytics/use-filters";
import { chartBuckets, formatMoment } from "@/lib/analytics/contracts";
import { AnalyticsControls } from "@/components/analytics/analytics-controls";
import { PerformanceMetrics } from "@/components/analytics/performance-metrics";
import { useQuery } from "@/lib/workflows/use-query";
import { eventLabels } from "@/lib/leads/workflow-contracts";
import { fromDb } from "@/lib/leads/contracts";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  CalendarClock,
  Check,
  ChevronRight,
  Phone,
  PhoneMissed,
  Plus,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { useWorkspace } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";

export function Overview() {
  const { pages, timezone } = useWorkspace();
  const filters = useAnalyticsFilters();
  const day = filters.range.to;
  const q = useQuery(JSON.stringify([filters.filter]), () =>
    fetchAnalytics(filters.filter),
  );
  const data = q.data;
  const interested = data?.current.interested ?? 0,
    meetings = data?.summary.meetings ?? 0,
    followupCount = data?.current.scheduled ?? 0,
    callsToday = data?.summary.attempts ?? 0;
  const activities = data?.recent ?? [];
  const stats = [
    {
      label: "Active leads",
      value: data?.current.active ?? 0,
      icon: Users,
      color: "blue",
      detail: "Current lead count · selected scope",
      href: "/dash/pages",
    },
    {
      label:
        filters.period === "today"
          ? "Calls attempted today"
          : "Calls in period",
      value: callsToday,
      icon: Phone,
      color: "purple",
      detail: "Confirmed calls · selected period",
      href: "/dash/activity",
    },
    {
      label: "Interested leads",
      value: interested,
      icon: TrendingUp,
      color: "green",
      detail: "Current interested leads · selected scope",
      href: "/dash/pages",
    },
    {
      label: "Follow-ups",
      value: followupCount,
      icon: CalendarClock,
      color: "orange",
      detail: "Current pending schedules",
      href: "/dash/followups",
    },
    {
      label: "Unanswered calls",
      value: data?.summary.unanswered ?? 0,
      icon: PhoneMissed,
      color: "orange",
      detail: "No Answer outcomes · selected period",
      href: "/dash/attempts",
    },
    {
      label: "Meetings booked",
      value: meetings,
      icon: CalendarCheck,
      color: "green",
      detail: "Recorded bookings · selected period",
      href: "/dash/followups",
    },
    {
      label: "Archived leads",
      value: data?.current.archived ?? 0,
      icon: Users,
      color: "blue",
      detail: "Current archive · selected scope",
      href: "/dash/archive",
    },
  ];
  const buckets = chartBuckets(data?.daily || []);
  const daily = buckets.map((d) => d.calls);
  const dayLabels = buckets.map((d) =>
    new Date(d.from + "T12:00:00Z").toLocaleDateString("en", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    }),
  );
  const max = Math.max(...daily, 1);
  return (
    <>
      <div className="overview-date">
        <span className="online-dot" />
        {new Date(day + "T12:00:00Z")
          .toLocaleDateString(undefined, {
            timeZone: "UTC",
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })
          .toUpperCase()}
        <span className="demo-date-note">{timezone}</span>
      </div>
      <PageHeader
        title="A good day to connect."
        description="A little focus. A few good conversations. Let’s move things forward."
        actions={
          <Button asChild>
            <Link
              href={pages[0] ? `/dash/pages/${pages[0].id}` : "/dash/pages"}
            >
              <Phone size={16} />
              Start calling
              <ArrowUpRight size={15} />
            </Link>
          </Button>
        }
      />
      <DailyDiscipline />
      <AnalyticsControls state={filters} />
      {q.error && (
        <p role="alert" className="info-box">
          {q.error}
          <Button variant="ghost" onClick={q.retry}>
            Retry
          </Button>
        </p>
      )}
      <div className="stats-grid" aria-busy={q.loading}>
        {stats.map((s) => (
          <Link className="stat-card" href={s.href} key={s.label}>
            <div>
              <span>{s.label}</span>
              <span className={`stat-icon ${s.color}`}>
                <s.icon size={18} />
              </span>
            </div>
            <strong>
              {q.loading || !data ? "—" : s.value}
              <ArrowUpRight size={17} />
            </strong>
            <p>{s.detail}</p>
          </Link>
        ))}
      </div>
      <div className="overview-middle">
        <section className="panel activity-chart-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">STEADY STEPS, REAL PROGRESS</span>
              <h2>Your calls over time</h2>
            </div>
            <span className="date-chip">
              {filters.range.from} — {filters.range.to}
            </span>
          </div>
          <div className="chart-summary">
            <strong>{data ? daily.reduce((a, b) => a + b, 0) : "—"}</strong>
            <span>
              call attempts in selected period
              <br />
              <span className="small muted">
                Confirmed attempts · corrections excluded
              </span>
            </span>
            <span className="chart-legend">
              <i />
              Call attempts
            </span>
          </div>
          <div
            className="bar-chart"
            role="img"
            aria-label={`Call attempts over the last seven days: ${daily.join(", ")}`}
          >
            <div className="chart-guides">
              {[max, Math.round((max * 2) / 3), Math.round(max / 3), 0].map(
                (n, index) => (
                  <div key={index}>
                    <span>{n}</span>
                    <i />
                  </div>
                ),
              )}
            </div>
            <div className="chart-bars">
              {daily.map((n, i) => (
                <div className="chart-column" key={i}>
                  <div
                    className={`chart-bar ${i === 6 ? "today" : ""}`}
                    style={{ height: `${(n / max) * 100}%`, maxWidth: 34 }}
                    title={`${buckets[i].from} – ${buckets[i].to}: ${n} attempts`}
                  >
                    <span>{n}</span>
                  </div>
                  <span>{dayLabels[i] || "—"}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="chart-footer">
            <span>
              <span className="online-dot" />
              Every attempt is a step forward.
            </span>
            <Link href="/dash/activity">
              View activity
              <ArrowRight size={14} />
            </Link>
          </div>
        </section>
        <section className="panel today-panel">
          <div className="panel-heading">
            <h2>Selected period, at a glance</h2>
            <span className="summary-icon green">
              <Target size={18} />
            </span>
          </div>
          <p className="muted small">
            Make space for the conversations that matter.
          </p>
          <div className="today-stat">
            <span>
              <PhoneMissed size={17} />
              Unanswered calls
            </span>
            <strong>{data?.summary.unanswered ?? "—"}</strong>
          </div>
          <div className="today-stat">
            <span>
              <CalendarCheck size={17} />
              Meetings booked
            </span>
            <strong>{data ? meetings : "—"}</strong>
          </div>
          <div className="today-stat">
            <span>
              <Check size={17} />
              Calls in selected period
            </span>
            <strong>{data ? callsToday : "—"}</strong>
          </div>
          <div className="next-step">
            <span className="eyebrow">YOUR NEXT SMALL STEP</span>
            <h3>Keep the conversation going.</h3>
            <p>
              {data
                ? `${followupCount} businesses are waiting for a follow-up.`
                : "Follow-up totals are currently unavailable."}
            </p>
            <Link href="/dash/followups">
              See your follow-ups
              <ArrowRight size={15} />
            </Link>
          </div>
        </section>
      </div>
      <PerformanceMetrics summary={data?.summary} loading={q.loading} />
      <div className="overview-bottom">
        <section className="panel recent-panel">
          <div className="panel-heading">
            <div>
              <h2>Recent activity</h2>
              <p className="small muted">The latest from your calling desk.</p>
            </div>
            <Link className="text-link" href="/dash/activity">
              View all
              <ArrowRight size={14} />
            </Link>
          </div>
          <div className="recent-list">
            {!activities.length && (
              <p className="small muted">
                {q.loading
                  ? "Loading activity…"
                  : "Your confirmed actions will appear here."}
              </p>
            )}
            {activities.slice(0, 5).map((a) => (
              <Link href="/dash/activity" className="recent-row" key={a.id}>
                <span className="activity-circle">
                  <Phone size={15} />
                </span>
                <span className="recent-name">
                  <strong>{a.business_name}</strong>
                  <span>
                    {eventLabels[a.kind] || a.kind}
                    {a.voided_at ? " · corrected" : ""}
                  </span>
                </span>
                {a.outcome && (
                  <StatusBadge
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
                <time title={formatMoment(a.occurred_at, timezone)}>
                  {new Date(a.occurred_at).toLocaleTimeString(undefined, {
                    timeZone: timezone,
                    second: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </Link>
            ))}
          </div>
        </section>
        <section className="panel quick-pages">
          <div className="panel-heading">
            <div>
              <h2>Your lead pages</h2>
              <p className="small muted">Pick a page. Make a connection.</p>
            </div>
            <Link
              href="/dash/pages"
              aria-label="View all lead pages"
              className="icon-link"
            >
              <ArrowUpRight size={18} />
            </Link>
          </div>
          {pages.slice(0, 3).map((p) => (
            <Link
              className="quick-page"
              key={p.id}
              href={`/dash/pages/${p.id}`}
            >
              <span className={`country-icon ${p.color}`}>{p.flag}</span>
              <span>
                <strong>{p.name}</strong>
                <small>{p.leadCount} active leads</small>
              </span>
              <ChevronRight size={16} />
            </Link>
          ))}
          <Button variant="ghost" asChild className="full-width add-page-link">
            <Link href="/dash/pages">
              <Plus size={15} />
              Manage lead pages
            </Link>
          </Button>
        </section>
      </div>
    </>
  );
}
