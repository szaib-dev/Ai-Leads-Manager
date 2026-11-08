"use client";
import { workspaceQueryKey } from "@/lib/query/cache";
import { useQuery as useCachedQuery } from "@tanstack/react-query";
import type { ActionResult } from "@/lib/leads/contracts";
import { useWorkspace } from "@/components/providers";
export function useQuery<T>(
  queryKey: string,
  load: () => Promise<ActionResult<T>>,
) {
  const { ownerId, privacyEpoch, canFetch } = useWorkspace();
  const query = useCachedQuery({
    queryKey: workspaceQueryKey(
      ownerId,
      privacyEpoch,
      "workflow",
      queryKey,
    ),
    enabled: canFetch,
    queryFn: async ({ signal }) => {
      const result = await load();
      signal.throwIfAborted();
      if (result.error) throw new Error(result.error);
      if (result.data === undefined)
        throw new Error("No data returned. Please retry.");
      return result.data;
    },
  });
  return {
    data: canFetch ? query.data : undefined,
    error: canFetch
      ? query.data === undefined ? query.error?.message : undefined
      : "You are offline. Reconnect to load your workspace.",
    loading: canFetch && query.isPending,
    retry: () => {
      if (canFetch) void query.refetch();
    },
  };
}
