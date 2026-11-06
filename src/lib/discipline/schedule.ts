import { addDays, dayInZone } from "@/lib/analytics/contracts";
export const DISCIPLINE_ZONE = "Asia/Karachi";
export interface DisciplineActivity { id: string; title: string; time: string; start: number; end: number; target?: string }
export function scheduleForDay(day: string): DisciplineActivity[] {
  const weekday = new Date(day + "T12:00:00Z").getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  return [
    { id: "wake", title: "Wake up & breakfast", time: "9:00–10:00 AM", start: 540, end: 600 },
    { id: "research", title: "Research & planning", time: "10:00–11:00 AM", start: 600, end: 660 },
    { id: "pakistan", title: weekend || weekday === 5 ? "Pakistan lead research" : "Pakistan cold calls", time: "11:15 AM–12:50 PM", start: 675, end: 770, target: weekend || weekday === 5 ? undefined : "10–15 calls" },
    { id: "proposals", title: "Upwork proposals", time: "1:10–2:40 PM", start: 790, end: 880, target: "3–4 proposals" },
    { id: "clients", title: "Client work & follow-ups", time: "2:40–4:00 PM", start: 880, end: 960 },
    { id: "gym", title: "Gym", time: "4:00–6:30 PM", start: 960, end: 1110 },
    { id: "personal", title: "Personal time", time: "7:00–8:30 PM", start: 1140, end: 1230 },
    { id: "preparation", title: "Remaining proposals & preparation", time: "8:30–9:15 PM", start: 1230, end: 1275 },
    { id: "north-america", title: weekend ? "Research, proposals & client work" : "USA/Canada cold calls", time: "9:15 PM–12:15 AM (+1 day)", start: 1275, end: 1455, target: weekend ? undefined : "20 calls" },
    { id: "tracking", title: "Daily progress tracking", time: "12:15–12:45 AM", start: 15, end: 45 },
    { id: "reading", title: "Reading", time: "12:45–1:00 AM", start: 45, end: 60, target: "15 minutes" },
    { id: "sleep", title: "Sleep", time: "By 1:30 AM", start: 60, end: 540 },
  ];
}
export function disciplineAt(now: Date) {
  const day = dayInZone(DISCIPLINE_ZONE, now);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: DISCIPLINE_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const minutes = Number(parts.find(p => p.type === "hour")!.value) * 60 + Number(parts.find(p => p.type === "minute")!.value);
  const activities = scheduleForDay(day);
  // At midnight the active evening block still follows the previous day's rules.
  if (minutes < 15) activities[8] = scheduleForDay(addDays(day, -1))[8];
  const current = activities.find(a => a.end > 1440 ? minutes >= a.start || minutes < a.end - 1440 : minutes >= a.start && minutes < a.end);
  const next = [...activities].sort((a,b) => ((a.start - minutes + 1440) % 1440 || 1440) - ((b.start - minutes + 1440) % 1440 || 1440))[0];
  const weekday = new Date(day + "T12:00:00Z").getUTCDay();
  return { day, activities, current, next, weekend: weekday === 0 || weekday === 6, friday: weekday === 5 };
}
export function readCompleted(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    const ids = new Set(scheduleForDay("2026-11-02").map(a => a.id));
    return Array.isArray(parsed) ? [...new Set(parsed.filter((v): v is string => typeof v === "string" && ids.has(v)))] : [];
  } catch { return []; }
}
