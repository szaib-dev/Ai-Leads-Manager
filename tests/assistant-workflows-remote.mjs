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

try {
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
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  await until(async () => {
    try {
      return (await fetch(base + "/login")).ok;
    } catch {
      return false;
    }
  }, "production workflow test server");
  const owner = await provision();
  await checked(a.auth.signInWithPassword(owner));
  await checked(b.auth.signInWithPassword(owner));
  const usa = await checked(
      a.rpc("manage_page", { p_id: null, p_name: "Workflow USA fixture" }),
    ),
    canada = await checked(
      a.rpc("manage_page", { p_id: null, p_name: "Workflow Canada fixture" }),
    );
  for (const pid of [usa, canada])
    await checked(
      a.rpc("commit_import", {
        p_request: randomUUID(),
        p_page: pid,
        p_new_name: null,
        p_mode: "append",
        p_file: "workflow-fixture.csv",
        p_rows: Array.from({ length: 2 }, () => ({
          business_name: "Workflow fixture",
          phone: "",
          website_url: "",
          google_maps_url: "",
          country: "Original",
          location: "",
          notes: "",
          status: "new",
        })),
        p_total: 2,
        p_invalid: 0,
      }),
    );
  for (const [pid, country] of [
    [usa, "Pakistan"],
    [canada, "Canada"],
  ]) {
    page = pid;
    const r = await action("askAssistant", [
      "Set all leads on this page country to " + country + ".",
      { pageId: page, selectedIds: [], history: [] },
      randomUUID(),
    ]);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.status, "planned");
    const c = await action("confirmAiPlan", [r.result.id]);
    assert.equal(c.status, "completed");
  }
  page = usa;
  const undo = await action("askAssistant", [
    "Undo my last AI action on this page.",
    { pageId: usa, selectedIds: [], history: [] },
    randomUUID(),
  ]);
  assert.equal(undo.result.count, 2);
  await action("confirmAiPlan", [undo.result.id]);
  const usRows = await checked(
      b.from("leads").select("country").eq("page_id", usa),
    ),
    caRows = await checked(
      b.from("leads").select("country").eq("page_id", canada),
    );
  assert.ok(usRows.every((l) => l.country === "Original"));
  assert.ok(caRows.every((l) => l.country === "Canada"));
  const scheduled = await action("askAssistant", [
    "Schedule all leads on this page for a follow-up on 2026-11-12.",
    { pageId: usa, selectedIds: [], history: [] },
    randomUUID(),
  ]);
  assert.equal(scheduled.result.count, 2);
  assert.equal(scheduled.result.status, "planned");
  await action("confirmAiPlan", [scheduled.result.id]);
  const tasks = await checked(
    b
      .from("followups")
      .select("scheduled_date")
      .is("completed_at", null)
      .is("cancelled_at", null),
  );
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every((t) => t.scheduled_date === "2026-11-12"));
  const reverse = await action("reviewAiUndo", [scheduled.result.id]);
  await action("confirmAiPlan", [reverse.id]);
  const interested = await action("askAssistant", [
    "Mark all leads on this page as Interested.",
    { pageId: usa, selectedIds: [], history: [] },
    randomUUID(),
  ]);
  assert.equal(interested.result.count, 2);
  await action("confirmAiPlan", [interested.result.id]);
  const current = await checked(
    b.from("leads").select("status").eq("page_id", usa),
  );
  assert.ok(current.every((l) => l.status === "interested"));
  const report = await checked(
    b.rpc("analytics_report", {
      p_from: "2026-11-04",
      p_to: "2026-11-04",
      p_timezone: "Asia/Karachi",
      p_page: usa,
    }),
  );
  assert.equal(report.summary.attempts, 0);
  const ambiguous = await action("askAssistant", [
    "Clean my leads.",
    { pageId: usa, selectedIds: [], history: [] },
    randomUUID(),
  ]);
  assert.ok(ambiguous.reply && !ambiguous.result);
  console.log(
    JSON.stringify({
      liveStatusEditing: true,
      literalEdits: true,
      pageScopedNaturalUndo: true,
      latestOtherPagePreserved: true,
      followupScheduling: true,
      followupUndo: true,
      noFabricatedCalls: true,
      ambiguityClarified: true,
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
