"use client";

import { useSyncExternalStore } from "react";
import { useWorkspace } from "@/components/providers";
import { fetchAnalytics } from "@/lib/analytics/actions";
import { dayInZone } from "@/lib/analytics/contracts";
import { subscribeCalendar } from "@/lib/analytics/use-filters";
import { useQuery } from "@/lib/workflows/use-query";

export function TodayCalls() {
  const { timezone } = useWorkspace();
  const today = useSyncExternalStore(
    subscribeCalendar,
    () => dayInZone(timezone),
    () => dayInZone(timezone),
  );
  const { data } = useQuery(`today-calls:${timezone}:${today}`, () =>
    fetchAnalytics({ from: today, to: today, timezone }),
  );
  return (
    <div className="today-calls" aria-label="Today's call activity" title={timezone}>
      <span><strong>{data?.summary.attempts ?? "–"}</strong> calls today</span>
      <span><strong>{data?.summary.answered ?? "–"}</strong> answered</span>
    </div>
  );
}
