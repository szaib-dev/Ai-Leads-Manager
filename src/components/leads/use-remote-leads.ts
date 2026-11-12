"use client";
import { workspaceQueryKey } from "@/lib/query/cache";
import { useEffect, useSyncExternalStore } from "react";
import {
  useQuery as useCachedQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useWorkspace } from "@/components/providers";
import { replaceLead, subscribeLeadChanges } from "@/lib/realtime/lead-updates";
import { createClient } from "@/lib/supabase/browser";
import { fromDb, statusToDb } from "@/lib/leads/contracts";
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
  mode: "page" | "archive" | "attempts" | "callbacks" | "search",
  enabled: boolean,
) {
  const { canFetch, privacyEpoch, ownerId } = useWorkspace();
  const queryKey = workspaceQueryKey(
    ownerId,
    privacyEpoch,
    "leads",
    filters,
    pageId,
    mode,
  );
  const client = useQueryClient();
  const query = useCachedQuery({
    queryKey,
    enabled: enabled && canFetch,
    queryFn: async ({ signal }) => {
      const { data, error } = await createClient().rpc("workspace_leads", {
        p_page: pageId, p_mode: mode, p_search: filters.search.trim(),
        p_status: statusToDb[filters.status] || filters.status,
        p_phone: filters.phoneOnly, p_sort: filters.sort,
        p_offset: (filters.page - 1) * 15, p_limit: 15,
      }).abortSignal(signal);
      if (error) throw new Error(error.message);
      const result = data as unknown as Omit<LeadResult, "rows"> & { rows: Record<string, unknown>[] };
      return { ...result, rows: result.rows.map(fromDb) };
    },
  });
  const key = JSON.stringify(queryKey);
  useEffect(
    () =>
      subscribeLeadChanges((lead) => {
        if (enabled && canFetch)
          client.setQueryData<LeadResult>(JSON.parse(key), (data) =>
            data ? { ...data, rows: replaceLead(data.rows, lead) } : data,
          );
      }),
    [key, enabled, canFetch, client],
  );
  const state = {
    key,
    data: query.data || empty,
    error: query.data ? "" : query.error?.message || "",
  };

  return {
    data:
      enabled && canFetch && state.key === key
        ? {
            ...state.data,
            rows: state.data.rows.filter(
              (row) =>
                !row.deleted &&
                (mode === "search" || (mode === "archive" ? row.archived : !row.archived)) &&
                (mode !== "page" ||
                  ["New", "Interested"].includes(row.status)) &&
                (mode !== "attempts" ||
                  ["No Answer", "Voicemail"].includes(row.status)) &&
                (mode !== "callbacks" || row.status === "Awaiting Callback"),
            ),
          }
        : empty,
    error: !canFetch
      ? "You are offline. Reconnect to load your leads."
      : state.key === key
        ? state.error
        : "",
    loading: enabled && canFetch && query.isPending,
  };
}
