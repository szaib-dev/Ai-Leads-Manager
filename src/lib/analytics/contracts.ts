export const DEFAULT_TIMEZONE = "Asia/Karachi";
export const commonTimezones = [
  "Asia/Karachi",
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Toronto",
  "Europe/London",
  "Asia/Dubai",
] as const;
export function validTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format();
    return zone.length <= 100;
  } catch {
    return false;
  }
}
export function dayInZone(zone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export type Period = "today" | "yesterday" | "7days" | "30days" | "custom";
export interface AnalyticsFilter {
  from: string;
  to: string;
  timezone: string;
  pageId?: string;
}
export function rangeForDay(period: Exclude<Period, "custom">, today: string) {
  if (period === "yesterday") {
    const day = addDays(today, -1);
    return { from: day, to: day };
  }
  return {
    from: addDays(
      today,
      period === "7days" ? -6 : period === "30days" ? -29 : 0,
    ),
    to: today,
  };
}
export function presetRange(
  period: Exclude<Period, "custom">,
  timezone: string,
  now = new Date(),
) {
  return rangeForDay(period, dayInZone(timezone, now));
}
export function formatMoment(timestamp: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(new Date(timestamp));
}
export interface AnalyticsSummary {
  attempts: number;
  businesses_contacted: number;
  answered: number;
  unanswered: number;
  voicemails: number;
  interested: number;
  rejected: number;
  followups: number;
  meetings: number;
  callbacks: number;
  answer_rate: number;
  conversion_rate: number;
}
export interface AnalyticsReport {
  summary: AnalyticsSummary;
  current: {
    active: number;
    interested: number;
    unanswered: number;
    archived: number;
    scheduled: number;
  };
  daily: { day_key: string; calls: number }[];
  recent: import("@/lib/leads/workflow-contracts").ActivityEvent[];
  start_at: string;
  end_at: string;
  timezone: string;
}
export interface RangeActivity {
  rows: import("@/lib/leads/workflow-contracts").ActivityEvent[];
  total: number;
  summary: AnalyticsSummary;
}
export function chartBuckets(days: AnalyticsReport["daily"], max = 7) {
  const size = Math.max(1, Math.ceil(days.length / max));
  return Array.from({ length: Math.ceil(days.length / size) }, (_, i) => {
    const chunk = days.slice(i * size, (i + 1) * size);
    return {
      from: chunk[0].day_key,
      to: chunk.at(-1)!.day_key,
      calls: chunk.reduce((sum, d) => sum + d.calls, 0),
    };
  });
}
