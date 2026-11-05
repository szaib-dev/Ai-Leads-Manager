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
const base = "http://127.0.0.1:3026";
let owner, app, browser;
async function checked(p) { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; }
try {
 const account = { email: `mobile-qa-${randomUUID()}@example.invalid`, password: randomBytes(32).toString("base64url") };
 owner = (await checked(admin.auth.admin.createUser({ ...account, email_confirm: true }))).user.id;
 await checked(client.auth.signInWithPassword(account)); await checked(ssr.auth.signInWithPassword(account));
 await checked(client.rpc("commit_import", { p_request: randomUUID(), p_page: null, p_new_name: "Mobile QA", p_mode: "new", p_file: "mobile.csv", p_rows: [{business_name:"Long Business Aesthetics Studio",phone:"+12025550123",location:"Plot 3A/9 Sector D-4 Block 4/1 Mirpur Azad Kashmir "+"LongAddress".repeat(15),notes:"Street: "+"LongUnbrokenAddress".repeat(80)+"\nCategories: Skin care clinic, Beauty salon"}],p_total:1,p_invalid:0 }));
 const lead=(await checked(client.from("leads").select("*").eq("owner_id",owner)))[0];
 await checked(client.rpc("manage_whatsapp",{p_id:lead.id,p_expected:lead.updated_at,p_status:"Waiting for Reply",p_notes:"Mobile layout QA",p_date:null}));
 app=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","3026"],{windowsHide:true,stdio:"ignore"});
 await expect.poll(async()=>{try{return(await fetch(base+"/login")).status}catch{return 0}},{timeout:30000}).toBe(200);
 browser=await chromium.launch();const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.addCookies([...jar].map(([name,value])=>({name,value,url:base})));
 const page=await context.newPage();await page.goto(base+"/dash/whatsapp");
 for(const width of [320,390,430]) {
   await page.setViewportSize({width,height:844});
   await expect(page.getByRole("navigation",{name:"Mobile navigation"}).getByRole("link",{name:"WhatsApp",exact:true})).toBeVisible();
   const icons=await page.locator(".bottom-nav > a > svg, .bottom-nav > button > svg").evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
   assert.ok(Math.max(...icons)-Math.min(...icons)<=1,"bottom navigation icons align");
   await page.locator(".business-cell").filter({hasText:"Long Business Aesthetics Studio"}).click();
   const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
   const metrics=await dialog.evaluate(el=>({width:el.getBoundingClientRect().width,client:el.clientWidth,scroll:el.scrollWidth}));
   assert.ok(metrics.width<=width && metrics.scroll<=metrics.client+1,JSON.stringify({width,...metrics}));
   await dialog.getByRole("button",{name:"Delete lead",exact:true}).scrollIntoViewIfNeeded();
   await expect(dialog.getByRole("button",{name:"Delete lead",exact:true})).toBeInViewport();
   await page.screenshot({path:`.local-test-output/mobile-details-${width}.png`});
   await dialog.getByRole("button",{name:"Close dialog",exact:true}).click();
 }
 console.log("PASS: mobile navigation icons align and long lead details fit and scroll vertically at 320, 390, and 430px.");
} finally {
 await browser?.close();app?.kill();
 if(owner)await checked(admin.auth.admin.deleteUser(owner));
 for(const c of [admin,client,ssr]){await c.removeAllChannels();c.auth.stopAutoRefresh();c.realtime.disconnect();}
}
