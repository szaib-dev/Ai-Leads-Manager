// Production Next.js, hosted Supabase, real DeepSeek, disposable fictional data only.
// Run with --env-file-if-exists=.env --env-file-if-exists=.env.local after npm run build.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
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
};
const admin = createClient(url, testAdminKey(), options),
  client = createClient(url, key, options),
  jar = new Map();
const ssr = createServerClient(url, key, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false },
  cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (values) => values.forEach((c) => jar.set(c.name, c.value)),
  },
});
const base = "http://127.0.0.1:3005",
  report = {},
  operationChats = new Map(),
  manifest = JSON.parse(
    readFileSync(".next/server/server-reference-manifest.json", "utf8"),
  );
let app, browser, owner, page;
async function checked(job) {
  const r = await job;
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
async function start(withKey = true) {
  app = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3005",
    ],
    {
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: "production",
        DEEPSEEK_API_KEY: withKey ? process.env.DEEPSEEK_API_KEY : "",
      },
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  for (let i = 0; i < 100; i++) {
    assert.equal(app.exitCode, null, "Production server exited");
    try {
      if ((await fetch(base + "/login")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Production server did not start");
}
async function stop() {
  if (!app) return;
  const done = new Promise((r) => app.once("close", r));
  app.kill();
  await done;
  app = undefined;
}
async function action(name, args) {
  if (["confirmAiPlan", "cancelAiPlan", "reviewAiUndo"].includes(name)) {
    const conversationId = operationChats.get(args[0]);
    assert.ok(conversationId, "Operation must have a verified conversation");
    const result = await action("chatOperation", [
      {
        conversationId,
        operationId: args[0],
        action:
          name === "confirmAiPlan"
            ? "confirm"
            : name === "cancelAiPlan"
              ? "cancel"
              : "undo",
      },
    ]);
    if (result?.id) operationChats.set(result.id, conversationId);
    return result;
  }
  const entry = Object.entries(manifest.node).find(
    ([, v]) => v.exportedName === name,
  );
  assert.ok(entry, `Missing built action ${name}`);
  const response = await fetch(base + "/dash", {
    method: "POST",
    headers: {
      "Next-Action": entry[0],
      "Content-Type": "text/plain;charset=UTF-8",
      Origin: base,
      Cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; "),
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(115000),
  });
  const body = await response.text();
  for (const line of body.split("\n")) {
    let data;
    try {
      data = JSON.parse(line.slice(line.indexOf(":") + 1));
    } catch {
      continue;
    }
    if (
      data &&
      typeof data === "object" &&
      ("data" in data || "error" in data)
    ) {
      if (data.error) throw new Error(`Action ${name}: ${data.error}`);
      return data.data;
    }
  }
  throw new Error(`Action ${name} returned no payload (${response.status})`);
}
async function ask(text, context = {}, retry = 0) {
  const conversationId = randomUUID();
  const response = await fetch(base + "/api/ai/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      Cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; "),
    },
    body: JSON.stringify({
      conversationId,
      userMessageId: randomUUID(),
      assistantMessageId: randomUUID(),
      text,
      pageId: null,
      selectedIds: [],
      ...context,
    }),
    signal: AbortSignal.timeout(115000),
  });
  assert.equal(response.status, 200);
  const events = (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const error = events.find((e) => e.type === "error")?.text;
  if (
    error?.includes("Please wait before requesting more AI suggestions") &&
    retry < 2
  ) {
    console.log(
      "Respecting existing AI request rate limit before continuing verification.",
    );
    await new Promise((r) => setTimeout(r, 35000));
    return ask(text, context, retry + 1);
  }
  assert.ok(
    events.some((e) => e.type === "done"),
    error ?? "Chat did not finish",
  );
  const result = events.find((e) => e.type === "result")?.result;
  if (result) operationChats.set(result.id, conversationId);
  return {
    result,
    reply: events.find((e) => e.type === "done")?.message.content,
  };
}
async function activeCount() {
  return (
    await checked(client.from("leads").select("id").is("deleted_at", null))
  ).length;
}
async function commit(pid, rows) {
  return checked(
    client.rpc("commit_import", {
      p_request: randomUUID(),
      p_page: pid,
      p_new_name: null,
      p_mode: "append",
      p_file: "fictional.csv",
      p_rows: rows,
      p_total: rows.length,
      p_invalid: 0,
    }),
  );
}
try {
  const account = {
    email: `folio-intelligence-${randomUUID()}@example.invalid`,
    password: randomBytes(32).toString("base64url"),
  };
  owner = (
    await checked(
      admin.auth.admin.createUser({ ...account, email_confirm: true }),
    )
  ).user.id;
  await checked(client.auth.signInWithPassword(account));
  await checked(ssr.auth.signInWithPassword(account));
  const usa = await checked(
    client.rpc("manage_page", { p_id: null, p_name: "USA" }),
  );
  const canada = await checked(
    client.rpc("manage_page", { p_id: null, p_name: "Canada" }),
  );
  await commit(usa, [
    { business_name: "USA Missing Phone", country: "USA" },
    { business_name: "USA Has Phone", country: "USA", phone: "+12025550123" },
  ]);
  await commit(canada, [
    { business_name: "Canada Missing Phone", country: "Canada" },
  ]);
  await start();
  const deletion = (await ask("Delete all USA leads without phone numbers."))
    .result;
  assert.equal(deletion.action, "delete");
  assert.equal(deletion.count, 1);
  assert.equal(deletion.status, "planned");
  assert.equal(await activeCount(), 3);
  assert.equal(deletion.rows[0].business_name, "USA Missing Phone");
  await action("confirmAiPlan", [deletion.id]);
  assert.equal(await activeCount(), 2);
  const undo = await action("reviewAiUndo", [deletion.id]);
  await action("confirmAiPlan", [undo.id]);
  assert.equal(await activeCount(), 3);
  report.countryDeletionPreviewApprovalUndo = true;
  const ids = (
    await checked(client.from("leads").select("id").eq("page_id", usa))
  ).map((l) => l.id);
  const selected = (
    await ask("Remove these 2 selected businesses.", { selectedIds: ids })
  ).result;
  assert.equal(selected.count, 2);
  assert.deepEqual(selected.rows.map((l) => l.id).sort(), ids.sort());
  await action("cancelAiPlan", [selected.id]);
  assert.equal(await activeCount(), 3);
  report.selectedDeletionPreviewCancel = true;
  const imported = await commit(usa, [
    { business_name: "Latest Missing Website", country: "USA" },
    {
      business_name: "Latest With Website",
      country: "USA",
      website_url: "https://fictional.example",
    },
  ]);
  const latest = (
    await ask("Delete the leads from my latest import that have no websites.")
  ).result;
  assert.equal(latest.count, 1);
  assert.equal(latest.scope.importId, imported.id);
  assert.equal(latest.rows[0].business_name, "Latest Missing Website");
  await action("cancelAiPlan", [latest.id]);
  const stats = (await ask("Show statistics by status for all leads.")).result;
  assert.equal(stats.count, 5);
  assert.equal(
    stats.statistics.reduce((n, s) => n + s.count, 0),
    5,
  );
  const summary = (await ask("Show me my latest import summary.")).result;
  assert.equal(summary.importSummary.id, imported.id);
  assert.equal(summary.importSummary.imported, 2);
  report.latestImportDeletionStatisticsSummary = true;
  const greeting = await ask("Hi! What can you help me do?");
  assert.ok(greeting.reply && !greeting.result);
  report.conversationalAnswer = true;
  await action("saveImportMode", ["automatic"]);
  assert.equal((await action("importPreferences", [])).mode, "automatic");
  const text =
    "Business name,Phone,Website,Google Maps URL,Country,Notes\nFictional Auto Cafe,+12025550124,https://auto.example,https://maps.google.com/?cid=automatic-fixture,USA,Source supplied note";
  const automaticPage = await checked(
    client.rpc("manage_page", { p_id: null, p_name: "Automatic fixture page" }),
  );
  const input = {
    text,
    fileName: "automatic.csv",
    pageId: automaticPage,
    requestId: randomUUID(),
    mode: "append",
    newName: "",
  };
  let automatic = await action("prepareCsvImport", [input]);
  if (
    automatic.reviewReason?.includes(
      "Please wait before requesting more AI suggestions",
    )
  ) {
    report.importRateLimitManualFallback = true;
    console.log(
      "PASS: rate limit offers manual import; waiting for the existing rate window.",
    );
    await new Promise((r) => setTimeout(r, 35000));
    automatic = await action("prepareCsvImport", [input]);
  }
  assert.equal(automatic.mode, "automatic", automatic.reviewReason);
  assert.equal(automatic.result.imported, 1);
  assert.equal(
    (await action("prepareCsvImport", [input])).result.id,
    automatic.result.id,
  );
  const maps = "https://maps.google.com/?cid=deleted-page-fixture";
  const old = await checked(
    client.rpc("manage_page", { p_id: null, p_name: "Deleted fixture page" }),
  );
  await commit(old, [
    {
      business_name: "Old details",
      google_maps_url: maps,
      phone: "+12025550125",
    },
  ]);
  const original = (
    await checked(
      client.from("leads").select("id,updated_at").eq("page_id", old),
    )
  )[0];
  assert.equal(
    (await commit(usa, [{ business_name: "Must skip", google_maps_url: maps }]))
      .duplicates,
    1,
  );
  await checked(
    client.rpc("record_call", {
      p_lead: original.id,
      p_expected: original.updated_at,
      p_request: randomUUID(),
      p_outcome: "not_interested",
      p_notes: "Fictional rejected number",
    }),
  );
  await checked(
    client.rpc("manage_page", { p_id: old, p_name: null, p_delete: true }),
  );
  const reimport = await commit(usa, [
    {
      business_name: "Cleaner new details",
      google_maps_url: maps,
      phone: "+12025550125",
    },
  ]);
  assert.equal(reimport.imported, 1);
  let fresh = (
    await checked(client.from("leads").select("*").eq("import_id", reimport.id))
  )[0];
  assert.equal(fresh.previously_imported, true);
  assert.equal(
    await checked(client.rpc("is_lead_suppressed", { p_lead_id: fresh.id })),
    true,
  );
  await action("acknowledgeReimport", [fresh.id, fresh.updated_at]);
  fresh = (
    await checked(client.from("leads").select("*").eq("id", fresh.id))
  )[0];
  assert.equal(fresh.previously_imported, false);
  assert.equal(
    await checked(client.rpc("is_lead_suppressed", { p_lead_id: fresh.id })),
    true,
  );
  assert.equal(
    (
      await commit(usa, [
        {
          business_name: "Canada Missing Phone",
          phone: "+12025550123",
          website_url: "https://fictional.example",
        },
      ])
    ).imported,
    1,
  );
  report.liveDeletedPageReimportMarkNormalDoNotCallAndMapsOnlyDuplicates = true;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies(
    [...jar].map(([name, value]) => ({
      name,
      value,
      url: base,
      sameSite: "Lax",
    })),
  );
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(base + "/dash/ai?chat=" + operationChats.get(stats.id));
  await expect(
    page.getByText("Matching leads by status", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: /Matching leads/ }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Select USA Has Phone", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Review deletion of 1 selected", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message AI assistant" }),
  ).toHaveValue("Delete these 1 selected businesses.");
  await page.goto(base + "/dash/ai?chat=" + operationChats.get(summary.id));
  await expect(
    page.getByRole("button", { name: "Review import undo", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review import undo", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message AI assistant" }),
  ).toHaveValue(`Undo import ${imported.id}`);
  report.generativeChartTableSelectionAndImportActions = true;
  // Import undo physically removes its records and intentionally redacts old chat text.
  await action("undoImport", [automatic.result.id]);
  report.liveAutomaticMappingImportRetryUndo = true;
  await page.goto(base + "/dash/pages/" + usa);
  await page
    .getByRole("button", { name: "Application settings", exact: true })
    .click();
  await expect(
    page.getByRole("radio", { name: /Automatic AI mode/ }),
  ).toBeChecked();
  await page.getByRole("radio", { name: /Manual mode/ }).check();
  await page.getByRole("button", { name: "Save preference" }).click();
  await expect(
    page.getByRole("button", { name: "Save preference" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Import leads", exact: true }).click();
  await page.getByLabel("CSV file", { exact: true }).setInputFiles({
    name: "manual.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Business name,Phone\nManual Fixture,+12025550126"),
  });
  await expect(page.getByText("manual.csv", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review import", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Review import", exact: true })
    .click();
  await expect(page.getByText(/Review: 1 expected new leads/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  report.settingsAndManualPreview = true;
  const countBeforeDialer = (
    await checked(client.from("call_attempts").select("id"))
  ).length;
  for (const width of [1440, 412, 360]) {
    await page.setViewportSize({ width, height: 850 });
    const container = page.locator(
      width < 768 ? ".mobile-leads" : ".desktop-leads",
    );
    await container
      .getByRole("button", { name: /Record attempt for USA Has Phone/ })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("radio")).toHaveCount(6);
    const call = dialog.getByRole("link", { name: "Call business" });
    await expect(call).toHaveAttribute("href", "tel:+12025550123");
    await call.evaluate((el) =>
      el.addEventListener("click", (e) => e.preventDefault()),
    );
    await call.click();
    assert.equal(
      (await checked(client.from("call_attempts").select("id"))).length,
      countBeforeDialer,
    );
    const box = await dialog.boundingBox();
    assert.ok(box.x >= -1 && box.x + box.width <= width + 1);
    if (width < 768)
      assert.ok(box.y + box.height >= 849, "Mobile dialog is a bottom sheet");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    mkdirSync(".local-test-output/intelligence-ui", { recursive: true });
    await page.screenshot({
      path: `.local-test-output/intelligence-ui/calling-${width}.png`,
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  report.callingDesktopMobileBoundsAndDialerNoAttempt = true;
  await context.close();
  await stop();
  await start(false);
  const fallback = await browser.newContext({
    viewport: { width: 360, height: 850 },
    reducedMotion: "reduce",
  });
  await fallback.addCookies(
    [...jar].map(([name, value]) => ({
      name,
      value,
      url: base,
      sameSite: "Lax",
    })),
  );
  page = await fallback.newPage();
  await checked(client.rpc("set_import_mode", { p_mode: "automatic" }));
  await page.goto(base + "/dash/pages/" + usa);
  await page.getByRole("button", { name: "Import leads", exact: true }).click();
  const file = "Business name,Phone\nFallback Retained,+12025550127";
  const transfer = await page.evaluateHandle((csv) => {
    const data = new DataTransfer();
    data.items.add(new File([csv], "fallback.csv", { type: "text/csv" }));
    return data;
  }, file);
  const zone = page.getByRole("button", { name: /Drop your CSV here/ });
  await zone.dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(zone).toHaveAttribute("data-dragging", "true");
  await zone.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByText("fallback.csv", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: /DeepSeek|configured|server/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review import", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Review import", exact: true })
    .click();
  await expect(page.getByText(/Review: 1 expected new leads/)).toBeVisible();
  await page.getByRole("button", { name: "Import leads", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Import complete" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo this import" }).click();
  await expect(
    page.getByRole("button", { name: "Import undone" }),
  ).toBeDisabled();
  await page.screenshot({
    path: ".local-test-output/intelligence-ui/fallback-undo-360.png",
  });
  report.dragDropReducedMotionMissingKeyManualFallbackImportUndo = true;
  writeFileSync(
    ".local-test-output/intelligence-verification.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  if (page) {
    mkdirSync(".local-test-output/intelligence-ui", { recursive: true });
    await page
      .screenshot({
        path: ".local-test-output/intelligence-ui/failure.png",
        fullPage: true,
      })
      .catch(() => {});
    console.error(
      await page
        .locator("body")
        .ariaSnapshot()
        .catch(() => ""),
    );
  }
  throw e;
} finally {
  if (browser) await browser.close();
  await stop();
  await client.removeAllChannels();
  await ssr.removeAllChannels();
  await client.auth.signOut();
  await ssr.auth.signOut();
  if (owner) await checked(admin.auth.admin.deleteUser(owner));
  console.log("Disposable intelligence account removed; test servers closed.");
}
