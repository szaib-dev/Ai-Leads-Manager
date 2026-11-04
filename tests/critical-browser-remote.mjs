import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { testAdminKey } from "./fixtures/remote-admin-key.mjs";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, testAdminKey(), options),
  client = createClient(url, key, options),
  jar = new Map();
const ssr = createServerClient(url, key, {
  cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (values) => values.forEach((c) => jar.set(c.name, c.value)),
  },
});
const base = "http://127.0.0.1:3012",
  report = {};
let owner, browser, app, page;
async function checked(p) {
  const r = await p;
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
try {
  const account = {
    email: `critical-${randomUUID()}@example.invalid`,
    password: randomBytes(32).toString("base64url"),
  };
  owner = (
    await checked(
      admin.auth.admin.createUser({ ...account, email_confirm: true }),
    )
  ).user.id;
  await checked(client.auth.signInWithPassword(account));
  await checked(ssr.auth.signInWithPassword(account));
  app = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "--port", "3012"],
    { windowsHide: true, stdio: "ignore" },
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/login")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies(
    [...jar].map(([name, value]) => ({ name, value, url: base })),
  );
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const source =
    process.env.REIMPORT_CSV ??
    "C:/Users/szb84/Downloads/website_leads_export.csv";
  const csv = readFileSync(source); // User data stays in this disposable account, never in test output.
  async function importFile() {
    await page.goto(base + "/dash/pages");
    await page.getByRole("button", { name: "Import CSV", exact: true }).click();
    await page
      .getByLabel("CSV file", { exact: true })
      .setInputFiles({
        name: "80-leads.csv",
        mimeType: "text/csv",
        buffer: csv,
      });
    await expect(
      page.getByRole("button", { name: "Review import", exact: true }),
    ).toBeEnabled({ timeout: 30000 });
    await page
      .getByRole("button", { name: "Review import", exact: true })
      .click();
    await expect(page.getByText(/Review: 80 expected new leads/)).toBeVisible();
    await page
      .getByRole("button", { name: "Import leads", exact: true })
      .click();
    await expect(
      page.getByText(
        /80 imported · 0 Maps duplicates skipped · 0 invalid rows/,
      ),
    ).toBeVisible({ timeout: 30000 });
    const batches = await checked(
      client
        .from("imports")
        .select("page_id")
        .order("created_at", { ascending: false })
        .limit(1),
    );
    return batches[0].page_id;
  }
  const first = await importFile();
  await checked(client.rpc("manage_page", { p_id: first, p_delete: true }));
  const second = await importFile();
  assert.notEqual(first, second);
  report.actualCsv = "80 accepted, page deleted, same 80 accepted again";
  // Independent callback fixture and history on the real database.
  const seed = await checked(
    client.rpc("commit_import", {
      p_request: randomUUID(),
      p_page: null,
      p_new_name: "Callback QA",
      p_mode: "new",
      p_file: "callback.csv",
      p_rows: [
        {
          business_name: "Fictional Callback QA",
          phone: "+12025550123",
          google_maps_url: "https://maps.google.com/?cid=critical-browser",
        },
      ],
      p_total: 1,
      p_invalid: 0,
    }),
  );
  let lead = (
    await checked(client.from("leads").select("*").eq("page_id", seed.pageId))
  )[0];
  await checked(
    client.rpc("record_call", {
      p_lead: lead.id,
      p_expected: lead.updated_at,
      p_request: randomUUID(),
      p_outcome: "awaiting_callback",
      p_date: "2026-01-01",
      p_notes: "Callback QA notes",
    }),
  );
  await page.goto(base + "/dash/callbacks");
  await expect(
    page.getByText("Fictional Callback QA", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Overdue", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Called Back", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  assert.equal(
    (
      await checked(
        client.from("call_attempts").select("id").eq("lead_id", lead.id),
      )
    ).length,
    1,
  );
  report.callbacks =
    "Overdue and Called Back UI; exactly one initial call attempt";
  // Create conversations with real saved artifact messages, then open, switch and refresh.
  const chats = [];
  for (let i = 0; i < 2; i++) {
    const id = randomUUID();
    await checked(
      client.rpc("record_chat_import", {
        p_conversation: id,
        p_user: randomUUID(),
        p_assistant: randomUUID(),
        p_import: (
          await checked(
            client.from("imports").select("id").eq("page_id", second).limit(1),
          )
        )[0].id,
      }),
    );
    chats.push(id);
  }
  for (const id of chats) {
    await page.goto(base + "/dash/ai?chat=" + id);
    await expect(page.getByLabel("Chat import summary")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Chat import summary")).toBeVisible();
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /column .*does not exist|schema cache/i,
    );
  }
  await page.goto(base + "/dash/ai");
  await page
    .getByLabel("Message AI assistant")
    .fill("How many active leads are in my workspace?");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByLabel("Message AI assistant")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("article").last()).toContainText(
    /leads|records|workspace/i,
    { timeout: 115000 },
  );
  report.chats =
    "Created, opened two saved conversations, switched and refreshed with artifacts";
  // Hold preparation so immediate attachment state and independent typing can be observed.
  await page.goto(base + "/dash/ai");
  let release;
  const gate = new Promise((r) => (release = r));
  let held = false;
  await page.route("**/dash/ai", async (route) => {
    if (route.request().method() === "POST" && !held) {
      held = true;
      await gate;
    }
    try {
      await route.continue();
    } catch (e) {
      if (!String(e).includes("already handled")) throw e;
    }
  });
  await page
    .getByLabel("Attach CSV file", { exact: true })
    .setInputFiles({
      name: "attachment-qa.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("name,phone\nFictional Upload QA,123"),
    });
  await expect(
    page.getByText("attachment-qa.csv", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Message AI assistant").fill("Draft while processing");
  await expect(page.getByLabel("Message AI assistant")).toHaveValue(
    "Draft while processing",
  );
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  release();
  await page.unrouteAll({ behavior: "wait" });
  await expect(page.getByLabel("CSV attachment import")).toBeVisible();
  await expect(page.getByRole("button", {name:"Remove attachment", exact:true})).toBeEnabled({timeout:60000});
  await page.getByLabel("Attach CSV file", {exact:true}).setInputFiles({name:"broken.csv",mimeType:"text/csv",buffer:Buffer.from('name,notes\nFixture,"unclosed')});
  await expect(page.getByText("Failed", {exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Retry attachment",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Retry attachment",exact:true}).click();
  await expect(page.getByText("Failed",{exact:true})).toBeVisible();
  await expect(page.getByText("broken.csv",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Remove attachment",exact:true}).click();
  await expect(page.getByLabel("CSV attachment import")).toHaveCount(0);
  report.attachments =
    "Immediate filename, processing state, typing enabled, Send gated; replace, failed-file retry preserves filename, remove";
  await page.goto(base + "/dash/ai?chat=" + chats[0]);
  mkdirSync(".local-test-output", { recursive: true });
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/dash/ai?chat=" + chats[0], "/dash/callbacks"]) {
      await page.goto(base + route);
      await expect(page.getByRole("main")).toBeVisible();
      if(route.includes("ai?")) await expect(page.getByLabel("Chat import summary")).toBeVisible();
      else await expect(page.getByText("Fictional Callback QA", {exact:true})).toBeVisible();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `overflow ${width} ${route}`,
      );
      if (width === 390 || width === 1440)
        await page.screenshot({
          path:
            ".local-test-output/critical-" +
            (route.includes("ai?") ? "chat" : "callbacks") +
            "-" +
            width +
            ".png",
        });
    }
  }
  report.mobile =
    "360, 390, 768, 1440px: chat and callbacks have no page overflow";
  assert.deepEqual(errors, []);
  writeFileSync(
    ".local-test-output/critical-live.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  if (page) {
    await page
      .screenshot({ path: ".local-test-output/critical-failure.png" })
      .catch(() => {});
    console.error((await page.locator("body").ariaSnapshot()).slice(0, 9000));
  }
  throw e;
} finally {
  if (browser) await browser.close();
  if (app) app.kill();
  await client.removeAllChannels();
  await ssr.removeAllChannels();
  await client.auth.signOut();
  await ssr.auth.signOut();
  if (owner) await checked(admin.auth.admin.deleteUser(owner));
  console.log("Disposable verification account removed");
}
