"use client";
import { useEffect, useState } from "react";
import type { ActionResult } from "@/lib/leads/contracts";
import { useWorkspace } from "@/components/providers";
export function useQuery<T>(
  queryKey: string,
  load: () => Promise<ActionResult<T>>,
) {
  const { revision, canFetch } = useWorkspace();
  const key = JSON.stringify([queryKey, revision]);
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{
    key: string;
    version: number;
    data?: T;
    error?: string;
  }>({ key: "", version: -1 });
  // Drop old business payloads instead of retaining a cache across invalidation or disconnection.
  if (state.key !== key || (!canFetch && state.data !== undefined))
    setState({ key, version: -1 });
  useEffect(() => {
    if (!canFetch) return;
    let active = true;
    load()
      .then((r) => {
        if (active) setState({ key, version, data: r.data, error: r.error });
      })
      .catch(() => {
        if (active)
          setState({
            key,
            version,
            error: "Could not load data. Check your connection and retry.",
          });
      });
    return () => {
      active = false;
    };
    // Serialized query keys contain every argument. The workspace revision invalidates only mounted queries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, canFetch]);
  return {
    data: canFetch && state.key === key ? state.data : undefined,
    error: canFetch && state.key === key ? state.error : undefined,
    loading: !canFetch || state.key !== key || state.version !== version,
    retry: () => setVersion((v) => v + 1),
  };
}
