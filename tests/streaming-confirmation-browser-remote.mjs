import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { testAdminKey } from "./fixtures/remote-admin-key.mjs";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  options = { auth: { persistSession: false, autoRefreshToken: false } },
  admin = createClient(url, testAdminKey(), options),
  client = createClient(url, key, options),
  jar = new Map(),
  ssr = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (rows) => rows.forEach((c) => jar.set(c.name, c.value)),
    },
  }),
  base = "http://127.0.0.1:3018";
let owner, app, browser, page;
const report = {};
async function checked(p) {
  const r = await p;
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
async function send(chat, text, fileId) {
  const req = {
    conversationId: chat,
    userMessageId: randomUUID(),
    assistantMessageId: randomUUID(),
    text,
    pageId: null,
    selectedIds: [],
    ...(fileId ? { fileId } : {}),
  };
  const res = await fetch(base + "/api/ai/chat", {
    method: "POST",
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      Cookie: [...jar].map(([n, v]) => n + "=" + v).join("; "),
    },
    body: JSON.stringify(req),
  });
  assert.equal(res.status, 200);
  let rest = "",
    deltas = 0,
    done = false,
    answer = "";
  for await (const bytes of res.body) {
    rest += new TextDecoder().decode(bytes);
    const lines = rest.split("\n");
    rest = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const e = JSON.parse(line);
      if (e.type === "error") throw new Error(e.text);
      if (e.type === "delta") {
        assert.equal(done, false);
        deltas++;
      }
      if (e.type === "done") {
        done = true;
        answer = e.message.content;
      }
    }
  }
  assert.ok(done);
  assert.ok(
    deltas > 2,
    "Reply must arrive in multiple provider deltas before completion",
  );
  assert.doesNotMatch(answer, /\u2014|^#{1,6}\s|\*\*/m);
  return { answer, req, deltas };
}
try {
  const account = {
    email: `stream-qa-${randomUUID()}@example.invalid`,
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
    ["node_modules/next/dist/bin/next", "start", "--port", "3018"],
    { windowsHide: true, stdio: "ignore" },
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/login")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  const chat = randomUUID(),
    file = randomUUID(),
    csv = readFileSync(
      "C:/Users/szb84/Downloads/30_business_prospects.csv",
      "utf8",
    );
  await checked(
    client.rpc("store_chat_file", {
      p_id: file,
      p_conversation: chat,
      p_name: "30_business_prospects.csv",
      p_text: csv,
    }),
  );
  const explanation = await send(
    chat,
    "What kind of leads does this file contain? Explain it in plain paragraphs.",
    file,
  );
  report.realFileStreamingDeltas = explanation.deltas;
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies(
    [...jar].map(([name, value]) => ({ name, value, url: base })),
  );
  page = await context.newPage();
  await page.goto(base + "/dash/ai?chat=" + chat);
  await expect(
    page.getByRole("article", { name: "Assistant" }).first(),
  ).toBeVisible();
  await page
    .getByLabel("Message AI assistant")
    .fill("Create a new lead page from this file and choose a suitable name.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const stage = page
    .locator('[role="status"]')
    .filter({
      hasText:
        /Checking workspace|Reading the attached|Saving the leads|Writing reply/,
    })
    .first();
  await expect(stage).toBeVisible();
  const stageBox = await stage.boundingBox(),
    messageBox = await page
      .locator('[class*="markdown"]')
      .first()
      .boundingBox();
  assert.ok(
    Math.abs(stageBox.x - messageBox.x) < 2,
    `stage ${stageBox.x}, message ${messageBox.x}`,
  );
  mkdirSync(".local-test-output/chat-polish", { recursive: true });
  await page.screenshot({
    path: ".local-test-output/chat-polish/centered-stage.png",
  });
  await expect(page.getByLabel("Chat import summary")).toContainText(
    "30 imported",
    { timeout: 115000 },
  );
  assert.equal((await checked(client.from("leads").select("id"))).length, 30);
  report.actual30NotCalledImport = true;
  report.centeredProgress = true;
  for (const [index, confirmation] of [
    "hmm yeah",
    "yup that would be better",
  ].entries()) {
    const convo = randomUUID(),
      id = randomUUID();
    await checked(
      client.rpc("store_chat_file", {
        p_id: id,
        p_conversation: convo,
        p_name: "confirmation.csv",
        p_text:
          "name,website,status\nValid A,,Not called\nValid B,,Not called\nInvalid,not-a-url,Not called",
      }),
    );
    const proposal = await send(
      convo,
      "Create a new page called Confirmation " + index + " from this file.",
      id,
    );
    assert.match(proposal.answer, /2|two/i);
    assert.ok(
      (
        await checked(
          client.from("ai_chat_files").select("pending_import").eq("id", id),
        )
      )[0].pending_import,
    );
    await page.goto(base + "/dash/ai?chat=" + convo);
    await page.reload();
    const accepted = await send(convo, confirmation);
    assert.match(accepted.answer, /2|two/i);
    const batches = await checked(
      client
        .from("imports")
        .select("successful_rows,invalid_rows")
        .eq("request_id", accepted.req.assistantMessageId),
    );
    assert.equal(batches[0].successful_rows, 2);
    assert.equal(batches[0].invalid_rows, 1);
    assert.equal(
      (
        await checked(
          client.from("ai_chat_files").select("pending_import").eq("id", id),
        )
      )[0].pending_import,
      null,
    );
    report[confirmation] = true;
  }
  await page.goto(base + "/dash/ai?chat=" + chat);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel("Chat import summary")).toBeVisible();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `.local-test-output/chat-polish/chat-${width}.png`,
    });
  }
  report.flatRepliesNoEmDashes = true;
  writeFileSync(
    ".local-test-output/chat-polish/report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  if (page) {
    console.error((await page.locator("body").ariaSnapshot()).slice(-6000));
    await page
      .screenshot({ path: ".local-test-output/chat-polish-failure.png" })
      .catch(() => {});
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
  console.log("Disposable streaming account removed");
}
