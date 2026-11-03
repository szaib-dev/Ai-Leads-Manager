import assert from "node:assert/strict";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert.equal(
  new URL(url).hostname,
  "lypfxcohmsosedwptebu.supabase.co",
  "Target must be the explicitly authorized project",
);
assert.ok(key?.startsWith("sb_publishable_"));
const headers = { apikey: key };
const settingsResponse = await fetch(`${url}/auth/v1/settings`, { headers });
assert.equal(settingsResponse.status, 200);
const settings = await settingsResponse.json();
assert.equal(settings.disable_signup, true);
assert.equal(settings.external.email, true);
assert.notEqual(settings.external.anonymous_users, true);
const results = [];
for (const table of [
  "lead_pages",
  "leads",
  "imports",
  "call_attempts",
  "followups",
  "activity_events",
  "outreach_suppressions",
  "workspace_preferences",
  "operations",
  "operation_items",
  "import_members",
  "workflow_changes",
  "workspace_sync",
]) {
  const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
    headers,
  });
  assert.ok(
    [401, 403].includes(response.status),
    `Anonymous ${table} returned ${response.status}`,
  );
  results.push(table);
}
const privateSchema = await fetch(
  `${url}/rest/v1/suppression_keys?select=*&limit=1`,
  { headers: { ...headers, "Accept-Profile": "private" } },
);
assert.ok([400, 401, 403, 404, 406].includes(privateSchema.status));
const protectedRpcs = {
  workspace_pages: {},
  workspace_leads: {},
  manage_page: { p_id: null },
  save_lead: { p_id: null, p_expected: null, p_data: {} },
  preview_import: { p_urls: [] },
  commit_import: {
    p_request: null,
    p_page: null,
    p_new_name: null,
    p_mode: "new",
    p_file: "test.csv",
    p_rows: [],
    p_total: 0,
    p_invalid: 0,
  },
  undo_import: { p_id: null },
  record_call: {
    p_lead: null,
    p_expected: null,
    p_request: null,
    p_outcome: "no_answer",
  },
  manage_followup: { p_lead: null, p_expected: null, p_request: null },
  undo_workflow: { p_id: null },
  workspace_followups: { p_day: "2026-11-03" },
  workspace_activity: { p_day: "2026-11-03" },
  workspace_lead_history: { p_lead: null },
  workspace_overview: { p_day: "2026-11-03" },
  workspace_state: {},
  analytics_report: { p_from: "2026-11-03", p_to: "2026-11-03" },
  activity_range: { p_from: "2026-11-03", p_to: "2026-11-03" },
};
if (process.argv.includes("--with-ai"))
  Object.assign(protectedRpcs, {
    calling_history_range: { p_from: "2026-11-03", p_to: "2026-11-03" },
    ai_csv_reserve: {
      p_request: null,
      p_input_bound: 1000,
      p_server_token: null,
    },
    ai_csv_settle: {
      p_request: null,
      p_input: 0,
      p_output: 0,
      p_server_token: null,
    },
    ai_csv_status: {},
  });
if (process.argv.includes("--with-assistant"))
  Object.assign(protectedRpcs, {
    ai_context: {},
    ai_assistant_state: {},
    ai_set_mode: { p_mode: "autonomous" },
    ai_stage: { p_request: null, p_command: {}, p_token: null },
    ai_execute: { p_id: null, p_approved: true, p_token: null },
    ai_cancel: { p_id: null },
    ai_plan_result: { p_id: null },
  });
for (const [name, body] of Object.entries(protectedRpcs)) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.ok(
    [401, 403].includes(response.status),
    `Anonymous RPC ${name} returned ${response.status}`,
  );
}
console.log(
  JSON.stringify({
    project: "lypfxcohmsosedwptebu",
    registrationDisabled: true,
    emailLoginEnabled: true,
    anonymousLoginDisabled: true,
    anonymousTableReadsBlocked: results.length,
    anonymousLeadRpcsBlocked: Object.keys(protectedRpcs).length,
    privateSchemaNotPubliclyAccessible: true,
  }),
);
