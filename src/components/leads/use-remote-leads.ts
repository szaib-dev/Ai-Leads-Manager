"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useWorkspace } from "@/components/providers";
import { replaceLead, subscribeLeadChanges } from "@/lib/realtime/lead-updates";
import { fetchLeads } from "@/lib/leads/actions";
import type { LeadFilters, LeadResult } from "@/lib/leads/contracts";
const empty: LeadResult = {
  rows: [],
  total: 0,
  summary: { total: 0, ready: 0, contacted: 0, unanswered: 0 },
};
function subscribe(callback: () => void) {
  const media = window.matchMedia("(max-width: 767px)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
export function useMobileLayout() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia("(max-width: 767px)").matches,
    () => false,
  );
}
export function useRemoteLeads(
  filters: LeadFilters,
  pageId: string | undefined,
  mode: "page" | "archive" | "attempts" | "callbacks",
  enabled: boolean,
  version: number,
) {
  const { canFetch, privacyEpoch } = useWorkspace();
  const key = JSON.stringify([filters, pageId, mode, privacyEpoch]);
  const [state, setState] = useState<{
    key: string;
    data: LeadResult;
    error: string;
  }>({ key: "", data: empty, error: "" });
  if (state.key !== key || ((!enabled || !canFetch) && state.data !== empty))
    setState({ key, data: empty, error: "" });
  useEffect(() => {
    if (!enabled || !canFetch) return;
    let active = true;
    const timer = setTimeout(
      () => {
        fetchLeads({ ...filters, pageId, mode })
          .then((r) => {
            if (active)
              setState((previous) => ({
                key,
                data: r.data || previous.data,
                error: r.error || "",
              }));
          })
          .catch(() => {
            if (active)
              setState({
                key,
                data: empty,
                error: "Could not load leads. Check your connection and retry.",
              });
          });
      },
      filters.search ? 250 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key, version, enabled, canFetch, filters, pageId, mode]);
  useEffect(
    () =>
      subscribeLeadChanges((lead) => {
        if (enabled && canFetch)
          setState((current) =>
            current.key === key
              ? {
                  ...current,
                  data: {
                    ...current.data,
                    rows: replaceLead(current.data.rows, lead),
                  },
                }
              : current,
          );
      }),
    [key, enabled, canFetch],
  );
  return {
    data: enabled && canFetch && state.key === key ? state.data : empty,
    error: state.key === key ? state.error : "",
    loading:
      enabled &&
      (!canFetch ||
        state.key !== key ||
        (state.data === empty && !state.error)),
  };
}
