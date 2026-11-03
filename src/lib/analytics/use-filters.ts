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
export function useAnalyticsFilters() {
  const { timezone } = useWorkspace();
  const today = useSyncExternalStore(
    subscribeCalendar,
    () => dayInZone(timezone),
    () => dayInZone(timezone),
  );
  const [period, setPeriod] = useState<Period>("today"),
    [custom, setCustom] = useState(() => presetRange("today", timezone)),
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
