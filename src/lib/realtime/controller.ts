export type SyncStatus =
  "connecting" | "live" | "reconnecting" | "offline" | "stale" | "signed-out";
export interface SyncTransport {
  connect: (
    onRevision: (revision: number) => void,
    onStatus: (status: SyncStatus) => void,
  ) => () => void;
  readRevision: () => Promise<number>;
}
// One transport, one debounce queue and one tiny checkpoint read on reconnect/focus.
export function startWorkspaceSync(
  transport: SyncTransport,
  onChange: () => void,
  onStatus: (s: SyncStatus) => void,
  { batchMs = 200, pollMs = 120000 } = {},
) {
  let transportStatus: SyncStatus = "connecting";
  let stopped = false,
    active = true,
    seen = -1,
    pending = -1,
    timer: ReturnType<typeof setTimeout> | undefined,
    inFlight: Promise<void> | undefined;
  let disconnect: () => void = () => {};
  function notify(revision: number, force = false) {
    if (stopped || (!force && revision <= seen)) return;
    pending = Math.max(pending, revision);
    if (!active) return;
    seen = Math.max(seen, revision);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      pending = -1;
      if (!stopped && active) onChange();
    }, batchMs);
  }
  async function reconcile() {
    if (stopped || !active) return;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const version = await transport.readRevision();
        if (!stopped && active) {
          notify(version);
          if (transportStatus === "live") onStatus("live");
        }
      } catch {
        if (!stopped) onStatus("stale");
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  }
  function connect() {
    disconnect();
    if (stopped) return;
    onStatus("connecting");
    disconnect = transport.connect(
      (v) => notify(v),
      (status) => {
        if (stopped) return;
        transportStatus = status;
        onStatus(status);
        if (status === "live") {
          void reconcile();
        }
      },
    );
  }
  connect();
  const poll = setInterval(() => {
    void reconcile();
  }, pollMs);
  return {
    acknowledge(version: number) {
      seen = Math.max(seen, version);
      if (timer && pending <= version) {
        clearTimeout(timer);
        timer = undefined;
        pending = -1;
      }
    },
    pause() {
      active = false;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    resume() {
      active = true;
      if (pending >= 0) {
        const queued = pending;
        seen = Math.min(seen, queued - 1);
        notify(queued);
      }
      void reconcile();
    },
    reconnect() {
      if (!stopped) {
        active = true;
        connect();
      }
    },
    stop() {
      stopped = true;
      disconnect();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    },
    reconcile,
  };
}
