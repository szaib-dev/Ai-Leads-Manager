// Production browser QA uses a disposable account only; no existing workspace data is changed.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium, expect } from "@playwright/test";
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
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, local?.adminKey ?? testAdminKey(), options),
  client = createClient(url, key, options),
  jar = new Map();
const ssr = createServerClient(url, key, {
  cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)),
  },
});
const base = "http://127.0.0.1:3028";
let owner, app, browser;
async function checked(p) {
  const r = await p;
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
try {
  const account = {
    email: `refresh-qa-${randomUUID()}@example.invalid`,
    password: randomBytes(32).toString("base64url"),
  };
  owner = (
    await checked(
      admin.auth.admin.createUser({ ...account, email_confirm: true }),
    )
  ).user.id;
  await checked(client.auth.signInWithPassword(account));
  await checked(ssr.auth.signInWithPassword(account));
  const batch = await checked(
    client.rpc("commit_import", {
      p_request: randomUUID(),
      p_page: null,
      p_new_name: "Refresh QA",
      p_mode: "new",
      p_file: "qa.csv",
      p_rows: [
        {
          business_name: "Mobile conversation studio",
          phone: "+12025550123",
          location: "LongUnbrokenAddress".repeat(14),
          notes: "Notes ".repeat(50),
        },
      ],
      p_total: 1,
      p_invalid: 0,
    }),
  );
  const lead = (
    await checked(client.from("leads").select("*").eq("owner_id", owner))
  )[0];
  await checked(
    client.rpc("manage_whatsapp", {
      p_id: lead.id,
      p_expected: lead.updated_at,
      p_status: "Waiting for Reply",
      p_notes: "Mobile notes",
      p_date: null,
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
      "3028",
    ],
    {
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ...(local
          ? {
              NODE_ENV: "development",
              NEXT_PUBLIC_SUPABASE_URL: url,
              NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
            }
          : {}),
      },
    },
  );
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(base + "/login")).status;
        } catch {
          return 0;
        }
      },
      { timeout: 90000 },
    )
    .toBe(200);
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.addCookies(
    [...jar].map(([name, value]) => ({ name, value, url: base })),
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/dash/pages/${batch.pageId}`);
  await page.getByRole("button", { name: "Add lead", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Business name", { exact: true })
    .fill("One manually added lead");
  await dialog.getByRole("button", { name: "Add lead", exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 20000 });
  await expect
    .poll(async () => {
      const rows = await checked(
        client
          .from("leads")
          .select("id,page_id")
          .eq("owner_id", owner)
          .eq("business_name", "One manually added lead"),
      );
      assert.ok(rows.every((r) => r.page_id === batch.pageId));
      return rows.length;
    })
    .toBe(1);
  // Hold data requests briefly to verify a genuine pending-state skeleton.
  await page.route("**/dash/whatsapp", async (route) => {
    if (route.request().method() === "POST")
      await new Promise((r) => setTimeout(r, 900));
    await route.continue();
  });
  await page.goto(base + "/dash/whatsapp");
  await expect(
    page.getByRole("status", { name: "Loading records" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".business-cell")
      .filter({ hasText: "Mobile conversation studio" }),
  ).toBeVisible({ timeout: 20000 });
  for (const width of [320, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(300);
    const metrics = await page.evaluate(() => ({
      inner: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    if (metrics.scroll > metrics.inner + 1)
      console.log(
        await page.locator("body *").evaluateAll((nodes) =>
          nodes
            .map((n) => ({
              tag: n.tagName,
              cls: n.className,
              right: n.getBoundingClientRect().right,
              width: n.getBoundingClientRect().width,
            }))
            .filter((n) => n.right > innerWidth + 1)
            .slice(0, 20),
        ),
      );
    assert.ok(
      metrics.scroll <= metrics.inner + 1,
      JSON.stringify({ width, ...metrics }),
    );
    if (width < 768) {
      await expect(
        page
          .getByRole("navigation", { name: "Mobile navigation" })
          .getByRole("button", { name: "More navigation" }),
      ).toBeInViewport();
      await expect(
        page.getByRole("combobox", {
          name: "Conversation status for Mobile conversation studio",
        }),
      ).toBeVisible();
    }
    await page.screenshot({
      path: `.local-test-output/refresh-whatsapp-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1280, height: 844 });
  assert.equal(await page.locator(".sidebar-pages").count(), 0);
  const icons = await page
    .locator('.main-nav a[href="/dash/whatsapp"] svg')
    .count();
  assert.equal(icons, 1);
  for (const path of ["/icon.svg", "/favicon.ico", "/apple-icon.png"])
    assert.equal((await fetch(base + path)).status, 200);
  assert.deepEqual(errors, []);
  console.log(
    (local ? "LOCAL TRANSPORT FIXTURE: " : "REAL SUPABASE: ") +
      "PASS: manual lead saved to existing page; pending skeleton; WhatsApp cards/desktop table fit 320/390/430/1280px; complete mobile navigation; sidebar removal; branded favicons; no browser errors.",
  );
} finally {
  await browser?.close();
  app?.kill();
  if (owner) await checked(admin.auth.admin.deleteUser(owner));
  await local?.close();
  for (const c of [admin, client, ssr]) {
    await c.removeAllChannels();
    c.auth.stopAutoRefresh();
    c.realtime.disconnect();
  }
}
