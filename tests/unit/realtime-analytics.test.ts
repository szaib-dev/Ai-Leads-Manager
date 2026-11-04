import test from "node:test";
import assert from "node:assert/strict";
import {
  dayInZone,
  presetRange,
  chartBuckets,
  validTimeZone,
  formatMoment,
} from "../../src/lib/analytics/contracts";
import {
  startWorkspaceSync,
  type SyncStatus,
} from "../../src/lib/realtime/controller";
import { supabaseSyncTransport } from "../../src/lib/realtime/supabase-transport";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database";
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
test("date presets use selected timezone midnight and inclusive calendar periods", () => {
  const instant = new Date("2026-11-02T19:00:00Z");
  assert.equal(dayInZone("Asia/Karachi", instant), "2026-11-03");
  assert.deepEqual(presetRange("yesterday", "Asia/Karachi", instant), {
    from: "2026-11-02",
    to: "2026-11-02",
  });
  assert.deepEqual(presetRange("7days", "Asia/Karachi", instant), {
    from: "2026-10-28",
    to: "2026-11-03",
  });
  assert.deepEqual(presetRange("30days", "Asia/Karachi", instant), {
    from: "2026-10-05",
    to: "2026-11-03",
  });
  assert.equal(
    dayInZone("America/New_York", new Date("2026-03-08T04:59:59Z")),
    "2026-03-07",
  );
  assert.ok(
    formatMoment(instant.toISOString(), "Asia/Karachi").includes("00:00:00"),
  );
  assert.equal(validTimeZone("Fake/Zone"), false);
});
test("chart bucketing preserves every aggregate without fetching records", () => {
  const days = Array.from({ length: 30 }, (_, i) => ({
    day_key: `2026-11-${String(i + 1).padStart(2, "0")}`,
    calls: i,
  }));
  const buckets = chartBuckets(days);
  assert.ok(buckets.length <= 7);
  assert.equal(
    buckets.reduce((s, b) => s + b.calls, 0),
    435,
  );
  assert.equal(buckets[0].from, days[0].day_key);
  assert.equal(buckets.at(-1)!.to, days.at(-1)!.day_key);
  assert.deepEqual(chartBuckets([]), []);
});
test("sync coalesces events, ignores duplicate revisions and acknowledges local writes", async () => {
  let event!: (v: number) => void,
    connects = 0,
    disconnects = 0,
    changes = 0;
  const c = startWorkspaceSync(
    {
      connect(e) {
        event = e;
        connects++;
        return () => {
          disconnects++;
        };
      },
      async readRevision() {
        return 0;
      },
    },
    () => changes++,
    () => {},
    { batchMs: 5, pollMs: 1000 },
  );
  event(1);
  event(2);
  event(3);
  await wait();
  assert.equal(changes, 1);
  event(3);
  await wait();
  assert.equal(changes, 1);
  event(4);
  c.acknowledge(4);
  await wait();
  assert.equal(changes, 1);
  c.stop();
  event(5);
  await wait();
  assert.equal(changes, 1);
  assert.equal(connects, 1);
  assert.equal(disconnects, 1);
});
test("sync reconnect reconciles lost changes and pause/resume avoids hidden reads", async () => {
  let value = 1,
    reads = 0,
    changes = 0,
    connections = 0,
    closed = 0,
    callback!: (s: SyncStatus) => void;
  const c = startWorkspaceSync(
    {
      connect(_e, status) {
        connections++;
        callback = status;
        return () => {
          closed++;
        };
      },
      async readRevision() {
        reads++;
        return value;
      },
    },
    () => changes++,
    () => {},
    { batchMs: 5, pollMs: 1000 },
  );
  callback("live");
  await wait();
  assert.equal(changes, 1);
  c.pause();
  value = 3;
  await c.reconcile();
  assert.equal(reads, 1);
  c.resume();
  await wait();
  assert.equal(changes, 2);
  c.reconnect();
  callback("live");
  await wait();
  assert.equal(connections, 2);
  assert.equal(closed, 1);
  assert.equal(changes, 2);
  c.stop();
  assert.equal(closed, 2);
});
test("sync reports checkpoint failures and discards late responses after cleanup", async () => {
  const statuses: SyncStatus[] = [];
  let rejectRead = true,
    resolve!: (n: number) => void,
    changes = 0;
  const c = startWorkspaceSync(
    {
      connect() {
        return () => {};
      },
      readRevision() {
        return rejectRead
          ? Promise.reject(new Error("network"))
          : new Promise((r) => {
              resolve = r;
            });
      },
    },
    () => changes++,
    (s) => statuses.push(s),
    { batchMs: 5, pollMs: 1000 },
  );
  await c.reconcile();
  assert.ok(statuses.includes("stale"));
  rejectRead = false;
  const request = c.reconcile();
  c.stop();
  resolve(7);
  await request;
  await wait();
  assert.equal(changes, 0);
});
test("Supabase adapter creates one owner-filtered channel, refreshes auth, and cleans all listeners", async () => {
  let auth!: (
    event: string,
    session: { access_token: string; user: { id: string } } | null,
  ) => void;
  let subscriptions = 0,
    removals = 0,
    unsubscribed = 0;
  const tokens: string[] = [],
    events: {
      type: string;
      filter: Record<string, unknown>;
      fn: (payload: never) => void;
    }[] = [];
  const channel = {
    on(
      type: string,
      filter: Record<string, unknown>,
      fn: (payload: never) => void,
    ) {
      events.push({ type, filter, fn });
      return this;
    },
    subscribe() {
      subscriptions++;
      return this;
    },
  };
  const client = {
    auth: {
      onAuthStateChange(fn: typeof auth) {
        auth = fn;
        return {
          data: {
            subscription: {
              unsubscribe() {
                unsubscribed++;
              },
            },
          },
        };
      },
      async getSession() {
        return {
          data: {
            session: {
              access_token: "initial-test-token",
              user: { id: "owner" },
            },
          },
          error: null,
        };
      },
    },
    realtime: {
      async setAuth(token: string) {
        tokens.push(token);
      },
    },
    channel() {
      return channel;
    },
    async removeChannel() {
      removals++;
    },
  } as unknown as SupabaseClient<Database>;
  const stop = supabaseSyncTransport(client, "owner").connect(
    () => {},
    () => {},
  );
  await wait();
  auth("TOKEN_REFRESHED", {
    access_token: "refreshed-test-token",
    user: { id: "owner" },
  });
  await wait();
  assert.equal(subscriptions, 1);
  assert.deepEqual(tokens, ["initial-test-token", "refreshed-test-token"]);
  assert.deepEqual(
    events
      .filter((e) => e.type === "postgres_changes")
      .map((e) => e.filter.event),
    ["INSERT", "UPDATE"],
  );
  assert.ok(
    events
      .filter((e) => e.type === "postgres_changes")
      .every(
        (e) =>
          e.filter.table === "workspace_sync" &&
          e.filter.filter === "owner_id=eq.owner",
      ),
  );
  stop();
  assert.equal(unsubscribed, 1);
  assert.equal(removals, 1);
  auth("SIGNED_IN", { access_token: "late-test-token", user: { id: "owner" } });
  await wait();
  assert.equal(subscriptions, 1);
});

test("dialer resume does not invalidate an unchanged workspace, but delivers changes received while hidden", async () => {
  let event!: (v: number) => void;
  let revision = 7,
    changes = 0;
  const sync = startWorkspaceSync(
    {
      connect(e) {
        event = e;
        return () => {};
      },
      async readRevision() {
        return revision;
      },
    },
    () => changes++,
    () => {},
    { batchMs: 5, pollMs: 10000 },
  );
  sync.acknowledge(7);
  sync.pause();
  sync.resume();
  await wait();
  assert.equal(changes, 0);
  sync.pause();
  event(8);
  revision = 8;
  sync.resume();
  await wait();
  assert.equal(changes, 1);
  sync.pause();
  sync.resume();
  await wait();
  assert.equal(changes, 1);
  sync.stop();
});
