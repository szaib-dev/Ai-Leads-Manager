"use client";
import { createWorkspaceQueryClient } from "@/lib/query/cache";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fetchWorkspaceState, managePage } from "@/lib/leads/actions";
import type { PageWithCounts } from "@/lib/leads/contracts";
import { createClient } from "@/lib/supabase/browser";
import { startWorkspaceSync, type SyncStatus } from "@/lib/realtime/controller";
import { supabaseSyncTransport } from "@/lib/realtime/supabase-transport";
import { DEFAULT_TIMEZONE, validTimeZone } from "@/lib/analytics/contracts";
interface Workspace {
  ownerId: string;
  aiSelection: { pageId?: string; ids: string[] };
  toggleAiLead: (id: string, pageId?: string) => void;
  clearAiSelection: () => void;
  recentAiImport: string | undefined;
  setRecentAiImport: (id: string | undefined) => void;
  pages: PageWithCounts[];
  privacyEpoch: number;
  canFetch: boolean;
  syncStatus: SyncStatus;
  retrySync: () => void;
  timezone: string;
  setTimezone: (zone: string) => void;
  refreshPages: () => Promise<void>;
  createPage: (name: string, description: string) => Promise<boolean>;
  toast: (message: string) => void;
}
const Context = createContext<Workspace | null>(null);
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("Workspace provider missing");
  return value;
}
export function Providers({
  children,
  initialRealPages,
  ownerId,
  initialRevision,
}: {
  children: ReactNode;
  initialRealPages: PageWithCounts[];
  ownerId: string;
  initialRevision: number;
}) {
  const [queryClient] = useState(createWorkspaceQueryClient);
  const [pages, setPages] = useState(initialRealPages),
    [privacyEpoch, setPrivacyEpoch] = useState(0),
    [canFetch, setCanFetch] = useState(true),
    [syncStatus, setSyncStatus] = useState<SyncStatus>("connecting"),
    [timezone, setZone] = useState<string>(DEFAULT_TIMEZONE),
    [notice, setNotice] = useState("");
  const [aiSelectionState, setAiSelectionState] = useState<{
    epoch: number;
    pageId?: string;
    ids: string[];
  }>({ epoch: 0, ids: [] });
  const [recentAiImport, setRecentAiImport] = useState<string>();
  const aiSelection =
    aiSelectionState.epoch === privacyEpoch && canFetch
      ? aiSelectionState
      : { ids: [] };
  function toggleAiLead(id: string, pageId?: string) {
    setAiSelectionState((s) => {
      const ids = s.epoch === privacyEpoch && s.pageId === pageId ? s.ids : [];
      return {
        epoch: privacyEpoch,
        pageId,
        ids: ids.includes(id)
          ? ids.filter((x) => x !== id)
          : [...ids, id].slice(0, 10000),
      };
    });
  }
  useEffect(()=>{
    if(!canFetch){void queryClient.cancelQueries();queryClient.clear();}
    else queryClient.removeQueries({predicate:q=>q.queryKey[0]!==ownerId||q.queryKey[1]!==privacyEpoch});
  },[privacyEpoch,canFetch,ownerId,queryClient]);
  const controller = useRef<ReturnType<typeof startWorkspaceSync> | null>(null),
    flight = useRef<Promise<void> | null>(null),
    again = useRef(false),
    mounted = useRef(false),
    initialCheckpoint = useRef(initialRevision);
  const refreshPages = useCallback<() => Promise<void>>(async () => {
    // Every revision refreshes visible records immediately, even while counts are busy.
    const invalidation = queryClient.invalidateQueries({ queryKey: [ownerId] });
    if (flight.current) {
      again.current = true;
      await Promise.all([flight.current, invalidation]);
      return;
    }
    const job = (async () => {
      let refreshedRevision: number | undefined;
      do {
        again.current = false;
        const r = await fetchWorkspaceState();
        if (!r.data) throw new Error(r.error);
        if (mounted.current && r.data.revision !== refreshedRevision) {
          refreshedRevision = r.data.revision;
          setPages(r.data.pages);
          await invalidation;
          controller.current?.acknowledge(r.data.revision);
        }
      } while (again.current && mounted.current);
    })();
    flight.current = job;
    try {
      await job;
    } finally {
      flight.current = null;
    }
  }, [ownerId, queryClient]);
  const toast = useCallback((message: string) => setNotice(message), []);
  const setTimezone = useCallback((zone: string) => {
    if (!validTimeZone(zone)) return;
    setZone(zone);
    try {
      localStorage.setItem("folio.timezone", zone);
    } catch {
      /* Preferences are optional when browser storage is disabled. */
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    try {
      const zone = localStorage.getItem("folio.timezone");
      if (zone && validTimeZone(zone)) queueMicrotask(() => setZone(zone));
    } catch {}
    const client = createClient();
    const sync = startWorkspaceSync(
      supabaseSyncTransport(client, ownerId, () =>
        setPrivacyEpoch((v) => v + 1),
      ),
      () => refreshPages(),
      (status) => {
        setSyncStatus(
          status !== "signed-out" && !navigator.onLine ? "offline" : status,
        );
        if (
          status === "live" &&
          navigator.onLine &&
          document.visibilityState === "visible"
        )
          setCanFetch(true);
        if (status === "signed-out") {
          setCanFetch(false);
          setPrivacyEpoch((v) => v + 1);
          setPages([]);
          try {
            for (const key of Object.keys(sessionStorage))
              if (key.startsWith(`folio.lead-view:${ownerId}:`))
                sessionStorage.removeItem(key);
          } catch {}
        }
      },
    );
    controller.current = sync;
    sync.acknowledge(initialCheckpoint.current);
    function availability() {
      const online = navigator.onLine,
        visible = document.visibilityState === "visible";
      // The phone dialer hides this tab. Keep the view and private drafts mounted.
      setCanFetch(online);
      if (!online) {
        sync.pause();
        setSyncStatus("offline");
        setPrivacyEpoch((v) => v + 1);
      } else if (!visible) {
        sync.pause();
      } else {
        sync.resume();
      }
    }
    function online() {
      availability();
      if (navigator.onLine) sync.reconnect();
    }
    document.addEventListener("visibilitychange", availability);
    window.addEventListener("online", online);
    window.addEventListener("offline", availability);
    availability();
    return () => {
      mounted.current = false;
      sync.stop();
      controller.current = null;
      document.removeEventListener("visibilitychange", availability);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", availability);
    };
  }, [ownerId, refreshPages]);
  async function createPage(name: string, description: string) {
    const r = await managePage({ name, description });
    if (r.error) {
      toast(r.error);
      return false;
    }
    await refreshPages();
    toast("Lead page created");
    return true;
  }
  return (
    <Context.Provider
      value={{
        ownerId,
        aiSelection,
        toggleAiLead,
        clearAiSelection: () =>
          setAiSelectionState({ epoch: privacyEpoch, ids: [] }),
        recentAiImport,
        setRecentAiImport,
        pages,
        privacyEpoch,
        canFetch,
        syncStatus,
        timezone,
        setTimezone,
        retrySync: () => {
          controller.current?.reconnect();
          void controller.current?.reconcile();
        },
        refreshPages,
        createPage,
        toast,
      }}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      <div className="toast-region" aria-live="polite">
        {notice && (
          <div className="toast">
            <span>{notice}</span>
            <button
              onClick={() => setNotice("")}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        )}
      </div>
    </Context.Provider>
  );
}
