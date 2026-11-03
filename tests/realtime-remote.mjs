// Live backend verification with two independent authenticated SDK sessions (not browser QA).
// Dedicated project only. Temporary confirmed users receive no email; all fixtures are removed.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { testAdminKey } from "./fixtures/remote-admin-key.mjs";
import { supabaseSyncTransport } from "../src/lib/realtime/supabase-transport.ts";
import { startWorkspaceSync } from "../src/lib/realtime/controller.ts";
import {
  presetRange,
  dayInZone,
  addDays,
} from "../src/lib/analytics/contracts.ts";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert.equal(new URL(url).hostname, "lypfxcohmsosedwptebu.supabase.co");
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
const admin = createClient(url, testAdminKey(), options),
  clients = [],
  users = [],
  stops = [];
const fixtureFile = ".local-test-output/phase5-fixture-users.json";
function client() {
  const c = createClient(url, key, options);
  clients.push(c);
  return c;
}
async function checked(p) {
  const r = await p;
  if (r.error)
    throw new Error(
      `Backend operation failed (${r.error.code || r.error.status || "request error"}). Details withheld.`,
    );
  return r.data;
}
async function until(check, label) {
  const end = Date.now() + 25000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out: ${label}`);
}
async function provision() {
  const password = randomBytes(32).toString("base64url"),
    email = `folio-phase5-${randomUUID()}@example.invalid`;
  const result = await checked(
    admin.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  users.push(result.user.id);
  writeFileSync(fixtureFile, JSON.stringify(users));
  return { id: result.user.id, email, password };
}
let cleaned = false;
try {
  const owner = await provision(),
    other = await provision(),
    a = client(),
    b = client(),
    c = client();
  await checked(
    a.auth.signInWithPassword({ email: owner.email, password: owner.password }),
  );
  await checked(
    b.auth.signInWithPassword({ email: owner.email, password: owner.password }),
  );
  await checked(
    c.auth.signInWithPassword({ email: other.email, password: other.password }),
  );
  function observer(sdk) {
    const transport = supabaseSyncTransport(sdk, owner.id);
    let status = "",
      changes = 0;
    const revisions = [];
    const wrapped = {
      readRevision: transport.readRevision,
      connect(onRevision, onStatus) {
        return transport.connect((v) => {
          revisions.push(v);
          onRevision(v);
        }, onStatus);
      },
    };
    const sync = startWorkspaceSync(
      wrapped,
      () => {
        changes++;
      },
      (s) => {
        status = s;
      },
      { batchMs: 20 },
    );
    stops.push(() => sync.stop());
    return {
      sync,
      revisions,
      get status() {
        return status;
      },
      get changes() {
        return changes;
      },
    };
  }
  const one = observer(a),
    two = observer(b);
  let expectRealtime = true;
  async function observed(request) {
    const before = two.revisions.length;
    const result = await checked(request);
    if (expectRealtime)
      await until(
        () => two.revisions.length > before,
        "mutation Realtime notification",
      );
    return result;
  }
  const foreign = [];
  let foreignReady = false;
  const channel = c
    .channel("phase5-rls", {
      config: { postgres_changes_options: { wait: true } },
    })
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "workspace_sync" },
      (p) => foreign.push(p),
    )
    .subscribe((s) => {
      if (s === "SUBSCRIBED") foreignReady = true;
    });
  stops.push(() => {
    void c.removeChannel(channel);
  });
  await until(
    () => one.status === "live" && two.status === "live" && foreignReady,
    "authenticated subscriptions ready",
  );
  const page = await observed(
    a.rpc("manage_page", { p_id: null, p_name: "Phase 5 live verification" }),
  );
  await until(async () => {
    const state = await checked(b.rpc("workspace_state"));
    return state.pages.some((p) => p.id === page);
  }, "page creation visible in session B");
  const before = two.revisions.length;
  await observed(
    a.rpc("commit_import", {
      p_request: randomUUID(),
      p_page: page,
      p_new_name: null,
      p_mode: "append",
      p_file: "phase5-fixtures.csv",
      p_rows: [
        { business_name: "Phase 5 first", phone: "+12025550111" },
        { business_name: "Phase 5 second", phone: "+12025550111" },
      ],
      p_total: 2,
      p_invalid: 0,
    }),
  );
  await until(() => two.revisions.length > before, "CSV notification");
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(
    two.revisions.length - before,
    1,
    "One notification for the whole import",
  );
  const leads = await checked(b.rpc("workspace_leads", { p_page: page }));
  assert.equal(leads.total, 2);
  const first = leads.rows[0].id,
    second = leads.rows[1].id;
  async function stamp(id) {
    const r = await checked(
      a.from("leads").select("updated_at").eq("id", id).single(),
    );
    return r.updated_at;
  }
  async function report(sdk = b) {
    const period = presetRange("today", "Asia/Karachi");
    return checked(
      sdk.rpc("analytics_report", {
        p_from: period.from,
        p_to: period.to,
        p_timezone: "Asia/Karachi",
        p_page: page,
      }),
    );
  }
  const call = {
    p_lead: first,
    p_expected: await stamp(first),
    p_request: randomUUID(),
    p_outcome: "no_answer",
    p_notes: "Exact live attempt note",
  };
  const notices = two.changes;
  await observed(a.rpc("record_call", call));
  await until(() => two.changes > notices, "call invalidation in session B");
  assert.equal((await report()).summary.attempts, 1);
  assert.equal(
    (await checked(b.rpc("workspace_leads", { p_mode: "attempts" }))).total,
    1,
  );
  const retryNotices = two.revisions.length;
  await checked(a.rpc("record_call", call));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await report()).summary.attempts, 1);
  assert.equal(
    two.revisions.length,
    retryNotices,
    "Retry must not publish another mutation",
  );
  await observed(
    a.rpc("save_lead", {
      p_id: first,
      p_expected: await stamp(first),
      p_data: { status: "interested" },
      p_action: "edit",
    }),
  );
  await until(
    async () => (await report()).current.interested === 1,
    "status synchronization",
  );
  assert.equal(
    (await report()).summary.unanswered,
    1,
    "Current status must not rewrite recorded outcome",
  );
  await observed(
    a.rpc("manage_followup", {
      p_lead: first,
      p_expected: await stamp(first),
      p_request: randomUUID(),
      p_action: "schedule",
      p_date: dayInZone("Asia/Karachi"),
      p_time: "10:15",
      p_notes: "Live callback",
    }),
  );
  await until(
    async () => (await report()).current.scheduled === 1,
    "follow-up visible in session B",
  );
  const tasks = await checked(
    b.rpc("workspace_followups", { p_day: dayInZone("Asia/Karachi") }),
  );
  const task = tasks.rows.find((t) => t.lead_id === first);
  await observed(
    a.rpc("manage_followup", {
      p_lead: first,
      p_expected: await stamp(first),
      p_request: randomUUID(),
      p_id: task.id,
      p_action: "schedule",
      p_date: addDays(dayInZone("Asia/Karachi"), 1),
      p_time: "14:30",
      p_notes: "Rescheduled live",
    }),
  );
  await until(async () => {
    const t = await checked(
      b
        .from("followups")
        .select("scheduled_time,notes")
        .eq("id", task.id)
        .single(),
    );
    return t.scheduled_time === "14:30:00" && t.notes === "Rescheduled live";
  }, "rescheduled details synchronized");
  await observed(
    a.rpc("manage_followup", {
      p_lead: first,
      p_expected: await stamp(first),
      p_request: randomUUID(),
      p_id: task.id,
      p_action: "complete",
    }),
  );
  await until(
    async () => (await report()).current.scheduled === 0,
    "completion synchronized",
  );
  await checked(b.auth.refreshSession());
  await new Promise((r) => setTimeout(r, 100));
  expectRealtime = false;
  two.sync.pause();
  b.realtime.disconnect();
  const missed = two.changes;
  await observed(
    a.rpc("record_call", {
      p_lead: second,
      p_expected: await stamp(second),
      p_request: randomUUID(),
      p_outcome: "voicemail",
      p_notes: "Written while B disconnected",
    }),
  );
  expectRealtime = true;
  two.sync.reconnect();
  await until(
    () => two.status === "live" && two.changes > missed,
    "reconnect checkpoint catch-up",
  );
  assert.equal((await report()).summary.attempts, 2);
  await observed(
    a.rpc("save_lead", {
      p_id: second,
      p_expected: await stamp(second),
      p_data: {},
      p_action: "archive",
    }),
  );
  await until(
    async () => (await report()).current.archived === 1,
    "archive synchronization",
  );
  await observed(
    a.rpc("save_lead", {
      p_id: first,
      p_expected: await stamp(first),
      p_data: {},
      p_action: "delete",
    }),
  );
  await until(
    async () => (await report()).current.active === 0,
    "lead removal synchronization",
  );
  const period = presetRange("today", "Asia/Karachi");
  const activity = await checked(
    b.rpc("activity_range", {
      p_from: period.from,
      p_to: period.to,
      p_timezone: "Asia/Karachi",
      p_page: page,
      p_limit: 100,
    }),
  );
  assert.ok(activity.rows.some((e) => e.kind === "followup_completed"));
  assert.ok(
    activity.rows.some(
      (e) => e.notes === "Exact live attempt note" && e.attempt_number === 1,
    ),
  );
  assert.deepEqual(
    await checked(
      c.from("workspace_sync").select("*").eq("owner_id", owner.id),
    ),
    [],
  );
  assert.equal(
    foreign.length,
    0,
    "Different authenticated account must receive no owner events",
  );
  console.log(
    JSON.stringify({
      live: true,
      sessions: 2,
      callSync: true,
      statusSync: true,
      followupScheduleRescheduleComplete: true,
      csvOneNotification: true,
      archiveAndRemovalSync: true,
      activityAndOrdinals: true,
      reconnectCatchUp: true,
      tokenRefresh: true,
      duplicateCountingPrevented: true,
      crossOwnerEventsBlocked: true,
      browserTesting: false,
    }),
  );
} finally {
  for (const stop of stops) stop();
  for (const sdk of clients) {
    await sdk.removeAllChannels();
    sdk.realtime.disconnect();
    sdk.auth.stopAutoRefresh();
  }
  const failures = [];
  for (const id of users) {
    const r = await admin.auth.admin.deleteUser(id);
    if (r.error) failures.push(id);
  }
  admin.auth.stopAutoRefresh();
  admin.realtime.disconnect();
  if (!failures.length) {
    try {
      unlinkSync(fixtureFile);
    } catch {}
    cleaned = true;
  } else
    throw new Error(
      "Temporary test users need cleanup; their IDs are in the ignored fixture-users file.",
    );
  if (cleaned)
    console.log(
      "PASS: temporary Auth users and all test records removed; subscription clients closed.",
    );
}
