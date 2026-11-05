// New production build, real Supabase, disposable account only.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium, expect } from "@playwright/test";
import { testAdminKey } from "./fixtures/remote-admin-key.mjs";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert.equal(new URL(url).hostname, "lypfxcohmsosedwptebu.supabase.co");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, testAdminKey(), options), client = createClient(url, key, options), jar = new Map();
const ssr = createServerClient(url, key, { cookies: { getAll: () => [...jar].map(([name,value]) => ({ name,value })), setAll: cs => cs.forEach(c => jar.set(c.name,c.value)) } });
const base = "http://127.0.0.1:3022";
let owner, app, browser;
async function checked(p) { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; }
try {
 const account = { email: `imports-ui-${randomUUID()}@example.invalid`, password: randomBytes(32).toString("base64url") };
 owner = (await checked(admin.auth.admin.createUser({ ...account, email_confirm: true }))).user.id;
 await checked(client.auth.signInWithPassword(account)); await checked(ssr.auth.signInWithPassword(account));
 const rows = [{ business_name: "Returned Maps QA", phone: "+12025550123", google_maps_url: "https://maps.google.com/?cid=987654321" }, { business_name: "Returned Phone QA", phone: "+12025550124" }];
 const result = await checked(client.rpc("commit_import", { p_request: randomUUID(), p_page: null, p_new_name: "Import refresh QA", p_mode: "new", p_file: "seed.csv", p_rows: rows, p_total: 2, p_invalid: 0 }));
 const originals = await checked(client.from("leads").select("*").eq("owner_id", owner));
 for (const l of originals) await checked(client.rpc("save_lead", { p_id: l.id, p_expected: l.updated_at, p_action: "delete", p_data: {} }));
 app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", "3022"], { windowsHide: true, stdio: "ignore" });
 await expect.poll(async () => { try { return (await fetch(base+"/login")).status; } catch { return 0; } }, { timeout: 30000 }).toBe(200);
 browser = await chromium.launch();
 const one = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), two = await browser.newContext();
 for (const context of [one,two]) await context.addCookies([...jar].map(([name,value]) => ({ name,value,url:base })));
 const a = await one.newPage(), b = await two.newPage();
 await Promise.all([a.goto(base+"/dash/pages/"+result.pageId), b.goto(base+"/dash/pages/"+result.pageId)]);
 await a.getByRole("button", { name: "Import leads", exact: true }).click();
 await a.getByLabel("CSV file", { exact: true }).setInputFiles({ name: "returned.csv", mimeType: "text/csv", buffer: Buffer.from('Name,Phone,Google Maps URL\nReturned Maps QA,+12025550123,https://maps.google.com/?cid=987654321\nReturned Phone QA,+12025550124,\nBrand New QA,+12025550125,https://maps.google.com/?cid=987654322') });
 await a.getByRole("button", { name: "Review import", exact: true }).click();
 await a.getByRole("button", { name: "Import leads", exact: true }).last().click();
 await expect(a.getByText(/3 imported/)).toBeVisible({ timeout: 45000 });
 await a.getByRole("button", { name: "View leads", exact: true }).click();
 for (const page of [a,b]) {
   await expect(page.locator("tr").filter({ hasText: "Brand New QA" })).toBeVisible({ timeout: 30000 });
   for (const name of ["Returned Maps QA", "Returned Phone QA"]) await expect(page.locator("tr").filter({ hasText: name })).toHaveClass(/previously-imported/);
   await expect(page.locator("tr").filter({ hasText: "Brand New QA" })).not.toHaveClass(/previously-imported/);
 }
 const leads = await checked(client.from("leads").select("*").eq("owner_id",owner).is("deleted_at",null));
 const l = leads.find(l => l.business_name === "Returned Maps QA");
 await checked(client.rpc("manage_whatsapp", { p_id:l.id,p_expected:l.updated_at,p_status:"Waiting for Reply",p_notes:"Manual notes",p_date:"2026-11-05" }));
 await Promise.all([a.goto(base+"/dash/whatsapp"), b.goto(base+"/dash/whatsapp")]);
 await expect(a.getByRole("table")).toBeVisible();
 await a.getByRole("combobox",{name:"Conversation status for Returned Maps QA"}).click();
 await a.getByRole("option",{name:"Interested",exact:true}).click();
 await expect(b.getByRole("combobox",{name:"Conversation status for Returned Maps QA"})).toContainText("Interested",{timeout:30000});
 await a.screenshot({ path: ".local-test-output/whatsapp-table-desktop.png", fullPage:true });
 await a.setViewportSize({width:390,height:844});
 await a.screenshot({ path: ".local-test-output/whatsapp-table-mobile.png", fullPage:true });
 assert.equal((await checked(client.from("call_attempts").select("id").eq("owner_id",owner))).length,0);
 console.log("PASS: CSV import appears in both mounted lists without reload; deleted Maps/fallback matches highlighted, new lead unmarked; WhatsApp table saves status inline across sessions. No call attempts.");
} finally {
 await browser?.close(); app?.kill();
 if (owner) await checked(admin.auth.admin.deleteUser(owner));
 for (const c of [admin,client,ssr]) { await c.removeAllChannels(); c.auth.stopAutoRefresh(); c.realtime.disconnect(); }
}
