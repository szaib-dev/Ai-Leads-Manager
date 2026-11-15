"use client";
import { useState, useSyncExternalStore } from "react";
import { useWorkspace } from "@/components/providers";
import {
  presetRange,
  dayInZone,
  rangeForDay,
  type Period,
  type AnalyticsFilter,
} from "@/lib/analytics/contracts";
export function subscribeCalendar(callback: () => void) {
  const timer = setInterval(callback, 60000);
  document.addEventListener("visibilitychange", callback);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", callback);
  };
}
export function useAnalyticsFilters(initialPeriod:Period="today") {
  const { timezone } = useWorkspace();
  const today = useSyncExternalStore(
    subscribeCalendar,
    () => dayInZone(timezone),
    () => dayInZone(timezone),
  );
  const [period, setPeriod] = useState<Period>(initialPeriod),
    [custom, setCustom] = useState(() => presetRange(initialPeriod==="custom"?"today":initialPeriod, timezone)),
    [pageId, setPageId] = useState("");
  const range = period === "custom" ? custom : rangeForDay(period, today);
  return {
    period,
    setPeriod,
    range,
    setCustom,
    pageId,
    setPageId,
    filter: {
      ...range,
      timezone,
      pageId: pageId || undefined,
    } satisfies AnalyticsFilter,
  };
}
