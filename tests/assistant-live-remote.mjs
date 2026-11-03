// Real Next.js Server Action + DeepSeek + Supabase verification. Not browser/device QA.
// Dedicated project, fictional records only; temporary Auth accounts and subscriptions are cleaned up.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { testAdminKey } from "./fixtures/remote-admin-key.mjs";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert.equal(new URL(url).hostname, "lypfxcohmsosedwptebu.supabase.co");
const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
  admin = createClient(url, testAdminKey(), options),
  b = createClient(url, key, options),
  outsider = createClient(url, key, options);
const users = [],
  jar = new Map(),
  fixtureFile = ".local-test-output/phase6-fixture-users.json";
const a = createServerClient(url, key, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false },
  cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (values) => values.forEach((c) => jar.set(c.name, c.value)),
  },
});
const base = "http://127.0.0.1:3003";
let app, channel;
async function checked(job) {
  const r = await job;
  if (r.error)
    throw new Error(
      `Remote operation failed (${r.error.code ?? r.error.status ?? "unknown"}): ${r.error.message}`,
    );
  return r.data;
}
async function provision() {
  const email = `folio-phase6-${randomUUID()}@example.invalid`,
    password = randomBytes(32).toString("base64url");
  const r = await checked(
    admin.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  users.push(r.user.id);
  writeFileSync(fixtureFile, JSON.stringify(users));
  return { id: r.user.id, email, password };
}
async function until(check, label) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out: ${label}`);
}
const manifest = JSON.parse(
  readFileSync(".next/server/server-reference-manifest.json", "utf8"),
);
function actionId(name) {
  const pair = Object.entries(manifest.node).find(
    ([, v]) =>
      v.exportedName === name && v.filename?.includes("assistant-actions"),
  );
  assert.ok(pair, `Built assistant action ${name} must exist`);
  return pair[0];
}
let page;
async function action(name, args, authenticated = true) {
  const response = await fetch(`${base}/dash/pages/${page}`, {
    method: "POST",
    headers: {
      "Next-Action": actionId(name),
      "Content-Type": "text/plain;charset=UTF-8",
      Origin: base,
      ...(authenticated
        ? { Cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; ") }
        : {}),
    },
    body: JSON.stringify(args),
    redirect: "manual",
    signal: AbortSignal.timeout(115000),
  });
  const text = await response.text();
  if (!authenticated) {
    assert.ok(
      response.headers.get("x-action-redirect")?.includes("/login") ||
        [303, 307].includes(response.status),
      `Unauthenticated action must redirect (${response.status})`,
    );
    return;
  }
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    try {
      const data = JSON.parse(line.slice(i + 1));
      if (
        data &&
        typeof data === "object" &&
        ("data" in data || "error" in data)
      ) {
        if (data.error) throw new Error(`Action ${name}: ${data.error}`);
        return data.data;
      }
    } catch (e) {
      if (e.message?.startsWith("Action ")) throw e;
    }
  }
  throw new Error(
    `Action ${name} did not return a confirmed payload (${response.status}).`,
  );
}
async function activeCount(client = b) {
  const r = await client
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("page_id", page)
    .is("deleted_at", null)
    .is("archived_at", null);
  if (r.error) throw new Error("Cannot count fixture leads");
  return r.count;
}
let notifications = 0;
try {
  const owner = await provision(),
    other = await provision();
  await checked(a.auth.signInWithPassword(owner));
  await checked(b.auth.signInWithPassword(owner));
  await checked(outsider.auth.signInWithPassword(other));
  page = await checked(
    a.rpc("manage_page", {
      p_id: null,
      p_name: "Phase 6 USA fixture",
      p_description: "",
    }),
  );
  const canada = await checked(
    a.rpc("manage_page", {
      p_id: null,
      p_name: "Phase 6 Canada fixture",
      p_description: "",
    }),
  );
  const rows = Array.from({ length: 4000 }, (_, i) => ({
    business_name: "Same imported fixture",
    phone: (i + 1) % 2 === 0 ? "" : "+12025550101",
    website_url: (i + 1) % 3 === 0 ? "" : "https://example.com",
    google_maps_url: "",
    country: "USA",
    location: "Austin",
    notes: "",
    status: "new",
  }));
  const batch = await checked(
    a.rpc("commit_import", {
      p_request: randomUUID(),
      p_page: page,
      p_new_name: null,
      p_mode: "append",
      p_file: "phase6-fictional.csv",
      p_rows: rows,
      p_total: 4000,
      p_invalid: 0,
    }),
  );
  assert.equal(batch.imported, 4000);
  assert.equal(await activeCount(), 4000);
  await checked(
    a.rpc("commit_import", {
      p_request: randomUUID(),
      p_page: canada,
      p_new_name: null,
      p_mode: "append",
      p_file: "canada-fictional.csv",
      p_rows: [{ ...rows[0], country: "Canada" }],
      p_total: 1,
      p_invalid: 0,
    }),
  );
  channel = b
    .channel(`phase6-${randomUUID()}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "workspace_sync",
        filter: `owner_id=eq.${owner.id}`,
      },
      () => notifications++,
    );
  await new Promise((resolve, reject) =>
    channel.subscribe((s) => {
      if (s === "SUBSCRIBED") resolve();
      if (s === "CHANNEL_ERROR")
        reject(new Error("Realtime subscription failed"));
    }),
  );
  let output = "";
  app = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3003",
    ],
    {
      windowsHide: true,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  app.stdout.on("data", (d) => {
    output = (output + d).slice(-2000);
  });
  app.stderr.on("data", (d) => {
    output = (output + d).slice(-2000);
  });
  await until(async () => {
    try {
      return (await fetch(`${base}/login`)).ok;
    } catch {
      return false;
    }
  }, "production test server");
  const state = await action("assistantState", []);
  assert.equal(state.mode, "strict");
  await action("assistantState", [], false);
  const context = {
    pageId: page,
    recentImportId: batch.id,
    selectedIds: [],
    history: [],
  };
  const search = await action("askAssistant", [
    "Show all leads on this page with no phone number AND no website.",
    context,
    randomUUID(),
  ]);
  assert.equal(search.result.count, 666);
  assert.equal(search.result.rows.length, 20);
  assert.equal(search.result.action, "search");
  const cleanup = await action("askAssistant", [
    "Remove leads from my latest import that have no phone number.",
    context,
    randomUUID(),
  ]);
  assert.equal(cleanup.result.count, 2000);
  assert.equal(cleanup.result.status, "planned");
  assert.equal(cleanup.result.requiresApproval, true);
  assert.equal(cleanup.result.scope.importId, batch.id);
  assert.equal(await activeCount(), 4000);
  const before = notifications;
  const started = Date.now();
  const confirmed = await action("confirmAiPlan", [cleanup.result.id]);
  assert.equal(confirmed.status, "completed");
  assert.equal(await activeCount(), 2000);
  await until(
    () => notifications > before,
    "cross-session AI cleanup notification",
  );
  const elapsed = Date.now() - started;
  const repeat = await action("confirmAiPlan", [cleanup.result.id]);
  assert.equal(repeat.id, confirmed.id);
  assert.equal(await activeCount(), 2000);
  const undo = await action("reviewAiUndo", [cleanup.result.id]);
  assert.equal(undo.status, "planned");
  await action("confirmAiPlan", [undo.id]);
  assert.equal(await activeCount(), 4000);
  const selected = await checked(
    a
      .from("leads")
      .select("id")
      .eq("page_id", page)
      .is("deleted_at", null)
      .limit(2),
  );
  await action("setAssistantMode", ["balanced"]);
  const note = await action("askAssistant", [
    'Append the note "Call after lunch" to the selected leads.',
    { ...context, selectedIds: selected.map((l) => l.id) },
    randomUUID(),
  ]);
  assert.equal(note.result.count, 2);
  assert.equal(note.result.status, "completed");
  const noted = await checked(
    b
      .from("leads")
      .select("notes")
      .in(
        "id",
        selected.map((l) => l.id),
      ),
  );
  assert.ok(noted.every((l) => l.notes === "Call after lunch"));
  const noteUndo = await action("reviewAiUndo", [note.result.id]);
  await action("confirmAiPlan", [noteUndo.id]);
  const union = await action("askAssistant", [
    "Show all leads on this page without a phone number OR without a website.",
    context,
    randomUUID(),
  ]);
  assert.equal(union.result.count, 2667);
  await action("setAssistantMode", ["autonomous"]);
  const archive = await action("askAssistant", [
    "Archive these results.",
    {
      ...context,
      previousResultId: union.result.id,
      history: [
        { role: "user", content: "Show leads missing phone OR website." },
        { role: "assistant", content: "2667 matched records." },
      ],
    },
    randomUUID(),
  ]);
  assert.equal(archive.result.count, 2667);
  assert.equal(archive.result.status, "completed");
  assert.equal(await activeCount(), 1333);
  const archiveUndo = await action("reviewAiUndo", [archive.result.id]);
  assert.equal(archiveUndo.status, "completed");
  assert.equal(await activeCount(), 4000);
  const forbidden = await action("askAssistant", [
    "Delete duplicate leads by phone number.",
    context,
    randomUUID(),
  ]);
  assert.ok(forbidden.reply.includes("cannot deduplicate"));
  assert.equal(await activeCount(), 4000);
  const otherResult = await outsider.rpc("ai_plan_result", {
    p_id: archive.result.id,
  });
  assert.ok(otherResult.error);
  const otherRows = await checked(
    outsider.from("operations").select("id").eq("id", archive.result.id),
  );
  assert.equal(otherRows.length, 0);
  const importUndo = await action("askAssistant", [
    "Undo my last CSV import.",
    context,
    randomUUID(),
  ]);
  assert.equal(importUndo.result.action, "undo_import");
  assert.equal(importUndo.result.status, "completed");
  assert.equal(await activeCount(), 0);
  const batches = await checked(
    b.from("imports").select("status").eq("id", batch.id),
  );
  assert.equal(batches[0].status, "rolled_back");
  console.log(
    JSON.stringify({
      liveAssistant: true,
      serverActions: true,
      records: 4000,
      andCount: 666,
      orCount: 2667,
      strictBalancedAutonomous: true,
      recentImportResolved: true,
      selectedLeads: true,
      previousResults: true,
      cleanupAndUndo: true,
      importUndo: true,
      idempotence: true,
      dedupRefused: true,
      crossOwnerBlocked: true,
      realtimeSecondSession: true,
      cleanupElapsedMs: elapsed,
      notifications,
      browserTesting: false,
    }),
  );
} finally {
  if (channel) await b.removeChannel(channel);
  await b.removeAllChannels();
  await a.removeAllChannels();
  await outsider.removeAllChannels();
  await a.auth.signOut();
  await b.auth.signOut();
  await outsider.auth.signOut();
  for (const id of users) {
    const r = await admin.auth.admin.deleteUser(id);
    if (r.error) throw new Error(`Fixture cleanup failed for user ${id}`);
  }
  if (users.length) unlinkSync(fixtureFile);
  if (app) {
    app.kill();
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(
    "Temporary Phase 6 accounts removed; channels and test server closed. Billing metadata retained.",
  );
}
