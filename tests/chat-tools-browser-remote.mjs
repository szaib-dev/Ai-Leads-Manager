// Live hosted services, production build, fictional records and disposable account.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { testAdminKey } from "./fixtures/remote-admin-key.mjs";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert.equal(new URL(url).hostname, "lypfxcohmsosedwptebu.supabase.co");
const auth = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};
const admin = createClient(url, testAdminKey(), { auth }),
  client = createClient(url, key, { auth }),
  jar = new Map();
const ssr = createServerClient(url, key, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false },
  cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (values) => values.forEach((c) => jar.set(c.name, c.value)),
  },
});
const base = "http://127.0.0.1:3006",
  report = {};
let app, browser, owner, page;
async function checked(job) {
  const r = await job;
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
async function start(withKey) {
  app = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3006",
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
    assert.equal(app.exitCode, null);
    try {
      if ((await fetch(base + "/login")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Test server did not start");
}
async function stop() {
  if (!app) return;
  const done = new Promise((r) => app.once("close", r));
  app.kill();
  await done;
  app = undefined;
}
async function chat(text, pageId = null) {
  const conversationId = randomUUID();
  const response = await fetch(base + "/api/ai/chat", {
    method: "POST",
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      Cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; "),
    },
    body: JSON.stringify({
      conversationId,
      userMessageId: randomUUID(),
      assistantMessageId: randomUUID(),
      text,
      pageId,
      selectedIds: [],
    }),
    signal: AbortSignal.timeout(115000),
  });
  assert.equal(response.status, 200);
  const events = (await response.text())
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
  assert.ok(
    events.some((e) => e.type === "done"),
    events.find((e) => e.type === "error")?.text ?? "Chat did not complete",
  );
  return {
    conversationId,
    result: events.find((e) => e.type === "result")?.result,
    events,
  };
}
async function count() {
  const rows = await checked(
    client.from("leads").select("id").is("deleted_at", null),
  );
  return rows.length;
}
async function contextFor(width = 1440) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
  });
  await context.addCookies(
    [...jar].map(([name, value]) => ({
      name,
      value,
      url: base,
      sameSite: "Lax",
    })),
  );
  return context;
}
try {
  const account = {
    email: `folio-chat-tools-${randomUUID()}@example.invalid`,
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
  const seedMaps = "https://maps.google.com/?cid=chat-tools-original";
  await checked(
    client.rpc("commit_import", {
      p_request: randomUUID(),
      p_page: usa,
      p_new_name: null,
      p_mode: "append",
      p_file: "seed.csv",
      p_total: 12,
      p_invalid: 0,
      p_rows: Array.from({ length: 12 }, (_, i) => ({
        business_name:
          i % 3 === 0
            ? `Skin Clinic ${i}`
            : i % 3 === 1
              ? `Hardware Tools ${i}`
              : `Generic Business ${i}`,
        notes:
          i % 3 === 0
            ? "Dermatology, acne and skin treatment clinic"
            : i % 3 === 1
              ? "Hardware retailer selling hammers, screws and building supplies"
              : "No service description supplied",
        country: "USA",
        phone: "+12025550123",
        google_maps_url: i === 0 ? seedMaps : "",
      })),
    }),
  );
  await start(true);
  const answer = await chat(
    "Which leads are irrelevant to skin clinics? Classify them as relevant, irrelevant or uncertain.",
    usa,
  );
  assert.equal(answer.result.count, 12);
  assert.equal(answer.result.analysis.items.length, 10);
  assert.ok(
    answer.result.analysis.items.some((r) => r.classification === "relevant"),
  );
  assert.ok(
    answer.result.analysis.items.some((r) => r.classification === "irrelevant"),
  );
  assert.ok(
    answer.result.analysis.items.some((r) => r.classification === "uncertain"),
  );
  assert.equal(await count(), 12);
  assert.ok(answer.events.filter((e) => e.type === "delta").length > 1);
  report.liveRelevanceEvidenceStreamingWithoutDeletion = true;
  console.log("PASS: live advisory classification and streaming");
  browser = await chromium.launch({ headless: true });
  const context = await contextFor();
  page = await context.newPage();
  page.setDefaultTimeout(25000);
  await page.goto(base + "/dash/ai?chat=" + answer.conversationId);
  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(
    page.getByRole("table", { name: "Relevance analysis results" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Filter relevance results" })
    .click();
  await page.getByRole("option", { name: "Irrelevant", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Select visible analysis records" })
    .check();
  const irrelevant = answer.result.analysis.items.filter(
    (r) => r.classification === "irrelevant",
  );
  await page
    .getByRole("button", {
      name: `Delete selected (${irrelevant.length})`,
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText(irrelevant[0].name);
  assert.equal(await count(), 12);
  await page
    .getByRole("button", {
      name: `Confirm delete ${irrelevant.length}`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Leads deleted", exact: true }),
  ).toBeVisible();
  assert.equal(await count(), 12 - irrelevant.length);
  await page
    .getByRole("button", { name: "Undo deletion", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Restored", exact: true }),
  ).toBeDisabled();
  assert.equal(await count(), 12);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Analyze next 10", exact: true })
    .click();
  await expect(page.getByText(/Reviewed 11–12 of 12/)).toBeVisible({
    timeout: 65000,
  });
  await page.reload();
  await expect(page.getByText(/Reviewed 11–12 of 12/)).toBeVisible();
  report.analysisFilteringCheckboxDeletionUndoNextBatchPersistence = true;
  console.log(
    "PASS: analysis selections, deletion/undo and bounded next batch",
  );
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  const csv = `Business name,Phone,Google Maps URL,Country,Description\nIncoming duplicate,+12025550123,${seedMaps},USA,Must preserve original\nNew Chat Clinic,+12025550124,https://maps.google.com/?cid=chat-tools-new,USA,Skin treatments`;
  await page.getByRole("button", { name: "Attach CSV", exact: true }).click();
  await page
    .getByLabel("Attach CSV file", { exact: true })
    .setInputFiles({
      name: "clinics.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
  await expect(
    page.getByRole("button", { name: "Confirm CSV import", exact: true }),
  ).toBeVisible({ timeout: 65000 });
  await expect(
    page.getByRole("combobox", { name: "Chat import destination" }),
  ).toContainText("USA");
  assert.equal(await count(), 12);
  await page
    .getByRole("button", { name: "Confirm CSV import", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Chat import summary" }),
  ).toContainText("1 imported", { timeout: 25000 });
  const importChat = new URL(page.url()).searchParams.get("chat");
  assert.ok(importChat);
  assert.equal(await count(), 13);
  const imported = (
    await checked(
      client
        .from("leads")
        .select("id,notes")
        .eq("business_name", "New Chat Clinic"),
    )
  )[0];
  assert.match(imported.notes, /Skin treatments/);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Chat import summary" }),
  ).toContainText("1 Maps duplicates");
  await page.getByRole("button", { name: "Undo import", exact: true }).click();
  await expect.poll(count, { timeout: 20000 }).toBe(12);
  assert.equal(
    (
      await checked(
        client
          .from("leads")
          .select("business_name")
          .eq("google_maps_url", seedMaps),
      )
    )[0].business_name,
    "Skin Clinic 0",
  );
  report.chatCsvApprovalDestinationExtraFieldsMapsRuleUndoHistory = true;
  console.log(
    "PASS: chat CSV import, exact Maps duplicate protection and undo",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Delete current chat", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /next for your leads/ }),
  ).toBeVisible();
  assert.equal(
    (
      await checked(
        client.from("ai_conversations").select("id").eq("id", importChat),
      )
    ).length,
    0,
  );
  assert.equal(await count(), 12);
  report.chatDeletionLeavesLeadsAndHistoryIntact = true;
  await checked(client.rpc("ai_set_mode",{p_mode:"autonomous"}));
  await page.getByLabel("Attach CSV file",{exact:true}).setInputFiles({name:"canada-clinics.csv",mimeType:"text/csv",buffer:Buffer.from("Business name,Country\nAutomatic Canada Clinic,Canada")});
  await expect(page.getByRole("region",{name:"Chat import summary"})).toContainText("1 imported",{timeout:65000});
  assert.equal(await count(),13);
  const canada=(await checked(client.from("lead_pages").select("id").eq("name","Canada").is("deleted_at",null)))[0];assert.ok(canada);
  assert.equal((await checked(client.from("leads").select("id").eq("page_id",canada.id).is("deleted_at",null))).length,1);
  await page.getByRole("button",{name:"Undo import",exact:true}).click();await expect.poll(count,{timeout:20000}).toBe(12);
  const advisory=await chat("Delete all leads irrelevant to skin clinics",usa);assert.equal(advisory.result.action,"search");assert.ok(advisory.result.analysis);assert.equal(await count(),12);
  report.autonomousAutomaticNewPageImportUndoAndNoRelevanceAutoDelete=true;
  await checked(client.rpc("ai_set_mode",{p_mode:"strict"}));
  await page.goto(base+"/dash/ai");
  for (const width of [360, 412]) {
    await page.setViewportSize({ width, height: 850 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const box = await page
        .getByRole("textbox", { name: "Message AI assistant" })
        .boundingBox(),
      bottom = await page.locator(".bottom-nav").boundingBox();
    assert.ok(box.y + box.height < bottom.y);
    await page
      .getByRole("button", { name: "AI settings", exact: true })
      .click();
    await page.getByRole("combobox", { name: "Chat theme" }).click();
    await page.getByRole("option", { name: "Dark", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    mkdirSync(".local-test-output/chat-tools-ui", { recursive: true });
    await page.screenshot({
      path: `.local-test-output/chat-tools-ui/chat-${width}.png`,
    });
  }
  report.compactToolbarPinnedComposerMobileThemes = true;
  await context.close();
  await stop();
  await start(false);
  const fallback = await contextFor(360);
  page = await fallback.newPage();
  await page.goto(base + "/dash/ai");
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(
        ["Business name,Phone,Country\nFallback Chat Clinic,+12025550125,USA"],
        "fallback-chat.csv",
        { type: "text/csv" },
      ),
    );
    return data;
  });
  await page
    .getByRole("region", { name: "AI workspace", exact: true })
    .dispatchEvent("dragover", { dataTransfer: transfer });
  await page
    .getByRole("region", { name: "AI workspace", exact: true })
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(
    page.getByRole("region", { name: "CSV attachment import" }),
  ).toContainText("fallback-chat.csv");
  await expect(
    page.getByRole("status").filter({ hasText: /not configured/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm CSV import", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Confirm CSV import", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Chat import summary" }),
  ).toBeVisible();
  assert.equal(await count(), 13);
  await page.getByRole("button", { name: "Undo import", exact: true }).click();
  await expect.poll(count, { timeout: 20000 }).toBe(12);
  report.missingKeyDropManualFallbackImportUndo = true;
  await page.goto(base + "/dash/pages/" + usa);
  const mobile = page.locator(".mobile-leads");
  await mobile.getByRole("checkbox").first().check();
  await mobile
    .getByRole("button", { name: "Delete selected (1)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm delete 1", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Leads deleted" }),
  ).toBeVisible();
  assert.equal(await count(), 11);
  await page
    .getByRole("button", { name: "Undo deletion", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Restored" })).toBeDisabled();
  assert.equal(await count(), 12);
  report.singleLeadCheckboxDeleteUndoWithoutAI = true;
  writeFileSync(
    ".local-test-output/chat-tools-verification.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  if (page) {
    mkdirSync(".local-test-output/chat-tools-ui", { recursive: true });
    await page
      .screenshot({
        path: ".local-test-output/chat-tools-ui/failure.png",
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
  console.log("Disposable chat tools verification account removed.");
}
