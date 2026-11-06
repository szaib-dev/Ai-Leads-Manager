// Production-build browser regression. LOCAL_UI_FIXTURE=1 uses the local backend; otherwise disposable Supabase account only.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium, expect } from "@playwright/test";
import { testAdminKey } from "./fixtures/remote-admin-key.mjs";
const local = process.env.LOCAL_UI_FIXTURE === "1" ? await import("./fixtures/workspace-backend.mjs").then(m=>m.startWorkspaceFixture()) : null;
const url = local?.url || process.env.NEXT_PUBLIC_SUPABASE_URL, key = local?.key || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if(!local) assert.equal(new URL(url).hostname, "lypfxcohmsosedwptebu.supabase.co");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, local?.adminKey || testAdminKey(), options), client = createClient(url, key, options), jar = new Map();
const ssr = createServerClient(url, key, { cookies: { getAll: () => [...jar].map(([name,value]) => ({ name,value })), setAll: cs => cs.forEach(c => jar.set(c.name,c.value)) } });
const base = "http://127.0.0.1:3028";
let owner, app, browser;
async function checked(p) { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; }
try {
 const account={email:`discipline-qa-${randomUUID()}@example.invalid`,password:randomBytes(32).toString("base64url")};
 owner=(await checked(admin.auth.admin.createUser({...account,email_confirm:true}))).user.id;
 await checked(client.auth.signInWithPassword(account));await checked(ssr.auth.signInWithPassword(account));
 if(local){const build=spawnSync(process.execPath,["node_modules/next/dist/bin/next","build"],{windowsHide:true,stdio:"ignore",env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key}});assert.equal(build.status,0,"fixture production build");}
 app=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","3028"],{windowsHide:true,stdio:"ignore",env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key}});
 await expect.poll(async()=>{try{return(await fetch(base+"/login")).status}catch{return 0}},{timeout:30000}).toBe(200);
 browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:"America/New_York"});
 await context.addCookies([...jar].map(([name,value])=>({name,value,url:base})));
 const page=await context.newPage();await page.clock.install({time:new Date("2026-11-02T06:30:00Z")});await page.goto(base+"/dash");
 const section=page.getByRole("region",{name:"Daily Discipline"});
 await expect(section.getByText("Now: Pakistan cold calls",{exact:true})).toBeVisible();
 const links=await page.locator('.main-nav>a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
 assert.deepEqual(links,["/dash","/dash/pages","/dash/whatsapp","/dash/attempts","/dash/followups","/dash/callbacks","/dash/activity","/dash/archive","/dash/ai"]);
 await section.locator("summary").click();
 await section.getByRole("checkbox",{name:"Complete Reading",exact:true}).check();
 await expect(section.getByRole("progressbar")).toHaveAttribute("aria-valuenow","1");
 await page.reload();await section.locator("summary").click();await expect(section.getByRole("checkbox",{name:"Complete Reading",exact:true})).toBeChecked();
 await expect(section.getByRole("checkbox",{name:"Complete Pakistan cold calls",exact:true})).not.toBeChecked();
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});
  const dimensions=await section.evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth}));assert.ok(dimensions.width<=width && dimensions.scroll<=dimensions.client+1);
  await page.evaluate(()=>document.documentElement.classList.add("dark"));await section.screenshot({path:`.local-test-output/discipline-dark-${width}.png`});
  await page.evaluate(()=>document.documentElement.classList.remove("dark"));await section.screenshot({path:`.local-test-output/discipline-light-${width}.png`});
 }
 await section.locator("summary").click();await expect(section.getByRole("checkbox",{name:"Complete Reading",exact:true})).toBeHidden();await section.locator("summary").click();
 await page.clock.setFixedTime(new Date("2026-11-02T19:05:00Z"));await page.clock.runFor(15000);
 await expect(section.getByRole("checkbox",{name:"Complete Reading",exact:true})).not.toBeChecked();await expect(section.getByRole("progressbar")).toHaveAttribute("aria-valuenow","0");
 await expect(section.getByText("Now: USA/Canada cold calls",{exact:true})).toBeVisible();
 console.log(local ? "Local backend fixture (not live Supabase)." : "Live Supabase.");
 console.log("PASS: desktop/mobile light/dark layout, exact navigation order, current/next activity, manual checkoff persistence, collapse, and Pakistan-midnight reset.");
} finally {
 await browser?.close();app?.kill();if(owner)await checked(admin.auth.admin.deleteUser(owner));for(const c of [admin,client,ssr]){await c.removeAllChannels();c.auth.stopAutoRefresh();c.realtime.disconnect();}await local?.close();
}
