// Uses real Supabase and DeepSeek with disposable fictional records. Never reads personal sessions.
// Run after npm run build with Node >=22 and the configured project's environment files.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { testAdminKey } from "./fixtures/remote-admin-key.mjs";
const local =
  process.env.LOCAL_UI_FIXTURE === "1"
    ? await import("./fixtures/workspace-backend.mjs").then((m) =>
        m.startWorkspaceFixture(),
      )
    : null;
const url = local?.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = local?.key ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!local)
  assert.equal(new URL(url).hostname, "lypfxcohmsosedwptebu.supabase.co");
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
const admin = createClient(url, local?.adminKey ?? testAdminKey(), options),
  client = createClient(url, key, options),
  jar = new Map();
const ssr = createServerClient(url, key, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false },
  cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (values) => values.forEach((c) => jar.set(c.name, c.value)),
  },
});
const base = "http://127.0.0.1:3004";
let app, browser, owner, debugPage;
const report = {};
// No Answer leads are routed to Attempts by the real database.
const pageLeadCount = local ? 31 : 30;
async function checked(job) {
  const r = await job;
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
async function stream(input) {
  const response = await fetch(`${base}/api/ai/chat`, {
    method: "POST",
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      Cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; "),
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(115000),
  });
  if (response.status !== 200)
    throw new Error(`Chat HTTP ${response.status}: ${await response.text()}`);
  let buffer = "",
    events = [],
    deltaTimes = [];
  const start = Date.now();
  for await (const chunk of response.body) {
    buffer += Buffer.from(chunk).toString();
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      events.push(event);
      if (event.type === "delta") deltaTimes.push(Date.now() - start);
    }
  }
  assert.ok(
    events.some((e) => e.type === "done"),
    events.find((e) => e.type === "error")?.text ?? "Missing completion",
  );
  return { events, deltaTimes };
}
function request(text, conversationId = randomUUID()) {
  return {
    conversationId,
    userMessageId: randomUUID(),
    assistantMessageId: randomUUID(),
    text,
    pageId: null,
    selectedIds: [],
  };
}
try {
  const account = {
    email: `folio-workspace-${randomUUID()}@example.invalid`,
    password: randomBytes(32).toString("base64url"),
  };
  owner = (
    await checked(
      admin.auth.admin.createUser({ ...account, email_confirm: true }),
    )
  ).user.id;
  await checked(client.auth.signInWithPassword(account));
  await checked(ssr.auth.signInWithPassword(account));
  const pakistan = await checked(
    client.rpc("manage_page", {
      p_id: null,
      p_name: "Pakistan",
      p_description: "Disposable browser verification",
    }),
  );
  const canada = await checked(
    client.rpc("manage_page", {
      p_id: null,
      p_name: "Canada",
      p_description: "Disposable browser verification",
    }),
  );
  const rows = await checked(
    client
      .from("leads")
      .insert(
        Array.from({ length: 31 }, (_, i) => ({
          page_id: pakistan,
          business_name: `Fixture business ${String(i + 1).padStart(2, "0")} with a readable long business name`,
          phone: "+12025550123",
          country: "Pakistan",
          location: "Karachi",
        })),
      )
      .select("id,updated_at"),
  );
  await checked(
    client.from("leads").insert({
      page_id: canada,
      business_name: "Canadian fixture",
      country: "Canada",
    }),
  );
  await checked(
    client.rpc("record_call", {
      p_lead: rows[0].id,
      p_expected: rows[0].updated_at,
      p_request: randomUUID(),
      p_outcome: "no_answer",
      p_notes: "A fictional call note for responsive history verification",
    }),
  );
  app = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      local ? "dev" : "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3004",
    ],
    {
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: local ? "development" : "production",
        ...(local
          ? {
              NEXT_PUBLIC_SUPABASE_URL: url,
              NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
              DEEPSEEK_API_KEY:
                process.env.LIVE_PROVIDER === "1"
                  ? process.env.DEEPSEEK_API_KEY
                  : "",
            }
          : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  app.stdout.on("data", (b) => (log = (log + b).slice(-3000)));
  app.stderr.on("data", (b) => (log = (log + b).slice(-3000)));
  for (let i = 0; i < 100; i++) {
    if (app.exitCode !== null) throw new Error(log);
    try {
      if ((await fetch(`${base}/login`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  const first = request("How many leads do I have?");
  if (local && process.env.LIVE_PROVIDER !== "1") {
    local.seedConversation(first);
    report.localUiFixture = true;
  } else {
    const answer = await stream(first);
    assert.equal(
      answer.events.find((e) => e.type === "result").result.count,
      32,
    );
    assert.ok(answer.deltaTimes.length > 1);
    const stages = answer.events
      .filter((e) => e.type === "stage")
      .map((e) => e.text);
    assert.ok(stages.includes("Searching leads…"));
    assert.ok(stages.includes("Generating response…"));
    await stream(first);
    assert.equal(
      (
        await checked(
          client
            .from("ai_chat_messages")
            .select("id")
            .eq("conversation_id", first.conversationId),
        )
      ).length,
      2,
    );
    const followup = await stream(
      request("How many Pakistani leads do I have?", first.conversationId),
    );
    assert.equal(
      followup.events.find((e) => e.type === "result").result.count,
      31,
    );
    report.liveDeepSeek = {
      deltas: answer.deltaTimes.length,
      firstDeltaMs: answer.deltaTimes[0],
      lastDeltaMs: answer.deltaTimes.at(-1),
      allLeadsCount: 32,
      pakistaniLeadsCount: 31,
      replayWithoutDuplicateMessages: true,
    };
  }
  console.log(
    "PASS: streaming/history setup",
    JSON.stringify(report.liveDeepSeek ?? { mocked: true }),
  );
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
  const page = await context.newPage();
  debugPage = page;
  page.on("pageerror", (e) => console.error("BROWSER ERROR", e.stack));
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      !m.text().includes("WebSocket connection") &&
      !m.text().includes("503")
    )
      console.error("BROWSER CONSOLE", m.text().slice(0, 1200));
  });
  page.setDefaultTimeout(20000);
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  await page.goto(`${base}/dash/ai?chat=${first.conversationId}`);
  if (!local)
    await expect(
      page.getByText("Matching leads across all pages", { exact: true }),
    ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "You", exact: true }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Toggle chat history" }).click();
  await expect(
    page.getByRole("complementary", { name: "Chat history" }),
  ).toContainText("How many leads");
  await page
    .getByRole("button", { name: "Close chat history", exact: true })
    .last()
    .click();
  await expect(page.getByText("Local demo workspace")).toHaveCount(0);
  await expect(
    page.getByText("A little help. A lot of potential."),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "New chat", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: /next for your leads/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Toggle chat history" }).click();
  await page
    .getByRole("complementary", { name: "Chat history" })
    .getByRole("button", { name: first.text, exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: "You", exact: true }),
  ).toHaveCount(2);
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: /next for your leads/ }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("article", { name: "You", exact: true }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "New chat", exact: true })
    .last()
    .click();
  report.chatReopeningAndHistoryNavigation = true;
  const input = page.getByRole("textbox", { name: "Message AI assistant" }),
    send = page.getByRole("button", { name: "Send message" });
  await expect(send).toBeDisabled();
  await input.fill("  ");
  await expect(send).toBeDisabled();
  await input.fill("first");
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("first\n");
  const posted = [];
  let release;
  const gate = new Promise((r) => (release = r));
  await page.route("**/api/ai/chat", async (route) => {
    posted.push(route.request().postDataJSON());
    await gate;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Fictional interrupted request" }),
    });
  });
  await input.fill("How many leads do I have?");
  await input.press("Enter");
  await expect(send).toBeDisabled();
  await input.fill("Do not submit twice");
  await input.press("Enter");
  await input.press("Enter");
  assert.equal(posted.length, 1);
  release();
  await expect(
    page.getByText("Fictional interrupted request", { exact: true }),
  ).toBeVisible();
  await expect(send).toBeEnabled();
  await page.unroute("**/api/ai/chat");
  await page.route("**/api/ai/chat", async (route) => {
    posted.push(route.request().postDataJSON());
    const r = posted.at(-1);
    const content =
      "**Recovered.**\n\n| Scope | Count |\n| --- | --- |\n| All Leads | 32 |";
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body:
        JSON.stringify({ type: "replace", text: content }) +
        "\n" +
        JSON.stringify({
          type: "done",
          message: {
            id: r.assistantMessageId,
            role: "assistant",
            content,
            status: "completed",
            error: null,
            reply_to: r.userMessageId,
            operation_id: null,
            created_at: new Date().toISOString(),
          },
        }) +
        "\n",
    });
  });
  await page.getByRole("button", { name: "Retry response" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  assert.equal(posted[0].userMessageId, posted[1].userMessageId);
  assert.equal(posted[0].assistantMessageId, posted[1].assistantMessageId);
  await expect(
    page.getByRole("article", { name: "You", exact: true }),
  ).toHaveCount(1);
  await page.unroute("**/api/ai/chat");
  report.composer = {
    enter: true,
    shiftEnter: true,
    whitespaceBlocked: true,
    busyLock: true,
    stableRetryIds: true,
    markdownTable: true,
  };
  mkdirSync(".local-test-output/workspace-ui", { recursive: true });
  await page.screenshot({
    path: ".local-test-output/workspace-ui/desktop-ai.png",
  });
  await page.goto(`${base}/dash/pages/${pakistan}`);
  await expect(page.locator(".desktop-leads tbody tr")).toHaveCount(15);
  await page
    .locator(".desktop-leads")
    .getByRole("button", { name: "Next page" })
    .click();
  await expect(page.locator(".desktop-leads .pagination")).toContainText(
    `16–30 of ${pageLeadCount}`,
  );
  const before = navigations;
  const openButton = page
    .locator(".desktop-leads tbody tr")
    .first()
    .getByRole("button")
    .filter({ hasText: "Fixture" })
    .first();
  await openButton.click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("combobox", { name: /^Status/ }).click();
  await page.getByRole("option", { name: "Interested", exact: true }).click();
  await page.getByRole("button", { name: "Save lead", exact: true }).click();
  await expect(page.getByText("Lead saved", { exact: true })).toBeVisible();
  assert.equal(navigations, before);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator(".desktop-leads .pagination")).toContainText(
    `16–30 of ${pageLeadCount}`,
  );
  console.log("PASS: desktop pagination and status editing");
  report.desktop = {
    pagination15: true,
    statusUpdateWithoutNavigation: true,
    pagePreserved: true,
  };
  // Two independently mounted browsers receive the actual owner-filtered Realtime signal.
  const second = await context.newPage();
  await second.goto(`${base}/dash/pages/${pakistan}`);
  await expect(second.locator(".desktop-leads tbody tr")).toHaveCount(15);
  const visibleBusiness = await second
    .locator(".desktop-leads tbody tr")
    .first()
    .locator("strong")
    .innerText();
  const visible = await checked(
    client
      .from("leads")
      .select("id,updated_at")
      .eq("page_id", pakistan)
      .eq("business_name", visibleBusiness)
      .in("status", ["new", "interested"])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1),
  );
  const changedName = "Realtime fixture updated in second session";
  await checked(
    client.rpc("save_lead", {
      p_id: visible[0].id,
      p_expected: visible[0].updated_at,
      p_data: { business_name: changedName },
    }),
  );
  if (local)
    await second.getByRole("button", { name: /Check for updates/ }).click();
  await expect(
    second.getByText(changedName, { exact: true }).first(),
  ).toBeVisible({ timeout: 20000 });
  report.realtimeSecondSession = !local;
  await second.close();
  report.mobile = [];
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(`${base}/dash/activity`);
    await expect(
      page.getByRole("heading", { name: "Calling history" }),
    ).toBeVisible();
    await expect(page.getByText("Attempt #1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Timezone", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Search timezones" })
      .fill("Pakistan");
    await expect(page.getByRole("menuitemradio")).toHaveCount(1);
    const box = await page.getByRole("menu").boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width);
    await page.getByRole("menuitemradio").click();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `.local-test-output/workspace-ui/history-${width}.png`,
      fullPage: true,
    });
    await page.goto(`${base}/dash/ai`);
    await expect(input).toBeVisible();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const composer = await input.boundingBox();
    const bottom = await page.locator(".bottom-nav").boundingBox();
    assert.ok(composer.y + composer.height < bottom.y);
    await page.screenshot({
      path: `.local-test-output/workspace-ui/ai-${width}.png`,
    });
    report.mobile.push({
      width,
      history: true,
      timezoneSearchAndBounds: true,
      aiComposerAboveBottomNav: true,
      noHorizontalOverflow: true,
    });
  }
  await page.goto(`${base}/dash/pages/${pakistan}`);
  await expect(page.locator(".mobile-leads .lead-card")).toHaveCount(15);
  await page
    .locator(".mobile-leads")
    .getByRole("button", { name: "Next page" })
    .click();
  await expect(page.locator(".mobile-leads .pagination")).toContainText(
    `16–30 of ${pageLeadCount}`,
  );
  const search = page.getByRole("textbox", { name: "Search mobile leads" });
  await search.fill("Fixture");
  await expect(page.locator(".mobile-leads .lead-card")).toHaveCount(15);
  await page
    .locator(".mobile-leads")
    .getByRole("button", { name: "Next page" })
    .click();
  await expect(page.locator(".mobile-leads .pagination")).toContainText(
    "16–30",
  );
  const beforeAttemptNavigation = navigations;
  await page
    .locator(".mobile-leads .lead-card")
    .first()
    .getByRole("button", { name: /Record attempt for/ })
    .click();
  await page.getByRole("radio", { name: "Interested", exact: true }).check();
  await page
    .getByRole("button", { name: "Confirm attempt", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "How did the call go?" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Call attempt recorded", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".mobile-leads .pagination")).toContainText(
    "16–30",
  );
  assert.equal(navigations, beforeAttemptNavigation);
  report.recordAttemptWithoutNavigation = true;
  await page.evaluate(() => window.scrollTo(0, 700));
  const position = await page.evaluate(() => scrollY),
    nav = navigations;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(search).toHaveValue("Fixture");
  await expect(page.locator(".mobile-leads .pagination")).toContainText(
    "16–30",
  );
  assert.equal(navigations, nav);
  assert.equal(await page.evaluate(() => scrollY), position);
  await page.reload();
  await expect(search).toHaveValue("Fixture");
  await expect(page.locator(".mobile-leads .pagination")).toContainText(
    "16–30",
  );
  report.resume = {
    simulatedVisibilitySwitchPreservesPageScrollSearch: true,
    discardRecovery: true,
  };
  await page.getByRole("button", { name: "Choose theme" }).click();
  await page.getByRole("menuitem", { name: /^Dark/ }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({
    path: ".local-test-output/workspace-ui/dark-mobile.png",
  });
  await page.getByRole("button", { name: "Choose theme" }).click();
  await page.getByRole("menuitem", { name: /^Light/ }).click();
  await expect(page.locator("html")).toHaveClass(/light/);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  report.lightTheme = true;
  report.database = local
    ? "Isolated HTTP fixture; SQL safety tested separately"
    : "Hosted Supabase";
  writeFileSync(
    ".local-test-output/workspace-verification.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (debugPage) {
    mkdirSync(".local-test-output/workspace-ui", { recursive: true });
    await debugPage.screenshot({
      path: ".local-test-output/workspace-ui/failure.png",
      fullPage: true,
    });
    console.error(await debugPage.locator("body").ariaSnapshot());
  }
  throw error;
} finally {
  if (browser) await browser.close();
  if (app) app.kill();
  await client.removeAllChannels();
  await ssr.removeAllChannels();
  await client.auth.signOut();
  await ssr.auth.signOut();
  if (owner) {
    const r = await admin.auth.admin.deleteUser(owner);
    if (r.error) throw new Error("Temporary fixture account cleanup failed");
  }
  if (local) await local.close();
  console.log(
    "Disposable verification account removed; fixture server closed.",
  );
}
