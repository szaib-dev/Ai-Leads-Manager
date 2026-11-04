import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { SyncTransport, SyncStatus } from "./controller";
export function supabaseSyncTransport(
  client: SupabaseClient<Database>,
  ownerId: string,
  onPrivacyChange?: () => void,
): SyncTransport {
  let privacyRevision: number | undefined;
  function privacy(row: Record<string, unknown>) {
    const next = Number(row.privacy_revision ?? 0);
    if (privacyRevision !== undefined && next > privacyRevision)
      onPrivacyChange?.();
    privacyRevision = next;
  }
  return {
    async readRevision() {
      const r = await client
        .from("workspace_sync")
        .select("revision,privacy_revision")
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (r.error) throw new Error("Could not check for updates");
      if (r.data) privacy(r.data);
      return Number(r.data?.revision ?? 0);
    },
    connect(onRevision, onStatus) {
      let stopped = false,
        channel: RealtimeChannel | null = null;
      function revision(payload: { new: Record<string, unknown> }) {
        if (!stopped && payload.new.owner_id === ownerId) {
          privacy(payload.new);
          const value = Number(payload.new.revision);
          if (Number.isSafeInteger(value) && value >= 0) onRevision(value);
        }
      }
      async function authenticate(token: string, userId: string) {
        if (stopped) return;
        if (userId !== ownerId) {
          if (channel) {
            void client.removeChannel(channel);
            channel = null;
          }
          onStatus("signed-out");
          return;
        }
        await client.realtime.setAuth(token);
        if (stopped || channel) return;
        channel = client
          .channel(`workspace:${ownerId}`, {
            config: { postgres_changes_options: { wait: true } },
          })
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "workspace_sync",
              filter: `owner_id=eq.${ownerId}`,
            },
            revision,
          )
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "workspace_sync",
              filter: `owner_id=eq.${ownerId}`,
            },
            revision,
          )
          .on("system", {}, (payload) => {
            if (payload.status === "error") onStatus("stale");
          })
          .subscribe((status) => {
            if (stopped) return;
            const mapping: Record<string, SyncStatus> = {
              SUBSCRIBED: "live",
              CHANNEL_ERROR: "reconnecting",
              TIMED_OUT: "reconnecting",
              CLOSED: "reconnecting",
            };
            onStatus(mapping[status] || "connecting");
          });
      }
      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((_event, session) => {
        queueMicrotask(() => {
          if (stopped) return;
          if (session)
            void authenticate(session.access_token, session.user.id).catch(() =>
              onStatus("stale"),
            );
          else {
            onStatus("signed-out");
            if (channel) {
              void client.removeChannel(channel);
              channel = null;
            }
          }
        });
      });
      void client.auth
        .getSession()
        .then(({ data, error }) => {
          if (stopped) return;
          if (error || !data.session) {
            onStatus("signed-out");
            return;
          }
          return authenticate(data.session.access_token, data.session.user.id);
        })
        .catch(() => {
          if (!stopped) onStatus("stale");
        });
      return () => {
        stopped = true;
        subscription.unsubscribe();
        if (channel) void client.removeChannel(channel);
        channel = null;
      };
    },
  };
}
