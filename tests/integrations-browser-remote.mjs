// New production build, real Supabase, disposable account only.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium, expect } from "@playwright/test";
import { testAdminKey } from "./fixtures/remote-admin-key.mjs";
const local=process.env.LOCAL_UI_FIXTURE === "1" ? await import("./fixtures/workspace-backend.mjs").then(m=>m.startWorkspaceFixture()) : null;
const url=local?.url || process.env.NEXT_PUBLIC_SUPABASE_URL,key=local?.key || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if(!local)assert.equal(new URL(url).hostname,"lypfxcohmsosedwptebu.supabase.co");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, local?.adminKey || testAdminKey(), options), client = createClient(url, key, options), jar = new Map();
const ssr = createServerClient(url, key, { cookies: { getAll: () => [...jar].map(([name,value]) => ({ name,value })), setAll: cs => cs.forEach(c => jar.set(c.name,c.value)) } });
const base = "http://127.0.0.1:3030";
let owner, app, browser;
async function checked(p) { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; }
try {
 const account={email:`api-qa-${randomUUID()}@example.invalid`,password:randomBytes(32).toString("base64url")};owner=(await checked(admin.auth.admin.createUser({...account,email_confirm:true}))).user.id;
 await checked(client.auth.signInWithPassword(account));await checked(ssr.auth.signInWithPassword(account));
 let batch;
 if(local){const pid=await checked(client.rpc("manage_page",{p_name:"API QA"}));await checked(client.from("leads").insert({page_id:pid,business_name:"Fictional API QA",phone:"+12025550123"}));batch={pageId:pid};const build=spawnSync(process.execPath,["node_modules/next/dist/bin/next","build"],{windowsHide:true,stdio:"ignore",env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key}});assert.equal(build.status,0);}
 else batch=await checked(client.rpc("commit_import",{p_request:randomUUID(),p_page:null,p_new_name:"API QA",p_mode:"new",p_file:"qa.csv",p_rows:[{business_name:"Fictional API QA",phone:"+12025550123"}],p_total:1,p_invalid:0}));
 app=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","3030"],{windowsHide:true,stdio:"ignore",env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key}});await expect.poll(async()=>{try{return(await fetch(base+"/login")).status}catch{return 0}},{timeout:30000}).toBe(200);
 browser=await chromium.launch();const context=await browser.newContext();await context.addCookies([...jar].map(([name,value])=>({name,value,url:base})));
 const a=await context.newPage(),b=await context.newPage();await a.goto(base+"/dash/settings/integrations");await b.goto(base+"/dash/pages/"+batch.pageId);
 await a.getByLabel("Key name",{exact:true}).fill("QA assistant");await a.getByRole("checkbox",{name:"Schedule meetings",exact:true}).check();await a.getByRole("button",{name:"Generate secret",exact:true}).click();const secretInput=a.getByRole("textbox",{name:"New API secret"});await expect(secretInput).toBeVisible({timeout:30000});const secret=await secretInput.inputValue();assert.ok(/^folio_[a-f0-9]{64}$/.test(secret));await a.getByRole("button",{name:"I saved it · hide secret",exact:true}).click();
 async function api(action,data={},requestId){const r=await fetch(base+"/api/v1/requests",{method:"POST",headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json",...(requestId?{"Idempotency-Key":requestId}:{})},body:JSON.stringify({action,data})});return {status:r.status,body:await r.json()};}
 assert.equal((await fetch(base+"/api/v1/requests",{method:"POST"})).status,401);const search=await api("leads.search",{query:"Fictional API QA"});assert.equal(search.status,200);const lead=search.body.data[0];
 const payload={leadId:lead.id,expectedUpdatedAt:lead.updated_at,startsAt:"2030-07-01T10:00:00-04:00",timezone:"America/New_York",notes:"API QA"},request=randomUUID();assert.equal((await api("meetings.create",payload,request)).status,200);assert.equal((await api("meetings.create",payload,request)).status,200);await expect(b.locator(".business-cell").filter({hasText:"Fictional API QA"})).toHaveCount(0,{timeout:30000});
 const fs=await checked(client.from("followups").select("*").eq("owner_id",owner).is("cancelled_at",null));assert.equal(fs.length,1);assert.equal(fs[0].scheduled_time,"19:00:00");assert.equal((await checked(client.from("call_attempts").select("id").eq("owner_id",owner))).length,0);
 await a.getByRole("button",{name:"Pause all requests",exact:true}).click();await expect(a.getByRole("button",{name:"Enable API requests",exact:true})).toBeVisible();assert.equal((await api("pages.list")).status,403);await a.getByRole("button",{name:"Enable API requests",exact:true}).click();await expect(a.getByRole("button",{name:"Pause all requests",exact:true})).toBeVisible();
 const card=a.locator("article.integration-card").filter({hasText:"QA assistant"}),read=card.getByRole("checkbox",{name:"View / search leads and pages",exact:true});await read.uncheck();await expect(read).not.toBeChecked();await expect(read).toBeEnabled();assert.equal((await api("pages.list")).status,403);await read.check();await expect(read).toBeChecked();await expect(read).toBeEnabled();assert.equal((await api("pages.list")).status,200);
 await card.getByRole("button",{name:"Pause key",exact:true}).click();await expect(card.getByRole("button",{name:"Enable key",exact:true})).toBeVisible();assert.equal((await api("pages.list")).status,403);await card.getByRole("button",{name:"Enable key",exact:true}).click();await expect(card.getByRole("button",{name:"Pause key",exact:true})).toBeVisible();
 await card.getByRole("button",{name:"Revoke key",exact:true}).click();await card.getByRole("button",{name:"Confirm revoke",exact:true}).click();await expect(card.getByText("Revoked",{exact:true})).toBeVisible();assert.equal((await api("pages.list")).status,401);
 await a.getByRole("button",{name:"Refresh",exact:true}).click();await expect(a.getByText("permission_disabled",{exact:true}).first()).toBeVisible();assert.equal((await(await fetch(base+"/api/v1/openapi.json")).json()).openapi,"3.1.0");await a.setViewportSize({width:390,height:844});await expect.poll(()=>a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await a.screenshot({path:".local-test-output/integrations-mobile.png",fullPage:true});
 console.log(local?"Local UI fixture, not live Supabase":"Live Supabase");console.log("PASS: one-time secret; HTTP auth; meeting/idempotency; realtime queue; global/key pause; permission disable/enable; revoke; audit; mobile. No secret logged.");
}finally{await browser?.close();app?.kill();if(owner)await checked(admin.auth.admin.deleteUser(owner));for(const c of [admin,client,ssr]){await c.removeAllChannels();c.auth.stopAutoRefresh();c.realtime.disconnect();}await local?.close();}
