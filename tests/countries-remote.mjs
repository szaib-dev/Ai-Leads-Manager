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
const base = "http://127.0.0.1:3027";
let owner, app, browser; const extraUsers=[],extraClients=[];
async function checked(p) { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; }
try {
 const account={email:`country-qa-${randomUUID()}@example.invalid`,password:randomBytes(32).toString("base64url")};
 owner=(await checked(admin.auth.admin.createUser({...account,email_confirm:true}))).user.id;
 await checked(client.auth.signInWithPassword(account));await checked(ssr.auth.signInWithPassword(account));
 const legacy=await checked(client.rpc("manage_page",{p_id:null,p_name:"Existing QA",p_description:"preserve me",p_delete:false}));
 app=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","3027"],{windowsHide:true,stdio:"ignore"});
 await expect.poll(async()=>{try{return(await fetch(base+"/login")).status}catch{return 0}},{timeout:30000}).toBe(200);
 browser=await chromium.launch();const contexts=await Promise.all([browser.newContext(),browser.newContext({viewport:{width:390,height:844}})]);
 for(const ctx of contexts)await ctx.addInitScript(()=>localStorage.setItem("theme","dark"));
 for(const ctx of contexts)await ctx.addCookies([...jar].map(([name,value])=>({name,value,url:base})));
 const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));await Promise.all([a.goto(base+"/dash/pages"),b.goto(base+"/dash/pages")]);
 await expect(a.locator(".country-card").filter({hasText:"Unassigned"})).toBeVisible();
 await a.getByRole("button",{name:"Create Country",exact:true}).click();await a.getByLabel("Country name",{exact:true}).fill("Pakistan");await a.getByRole("button",{name:"Save country",exact:true}).click();
 await expect(b.locator(".country-card").filter({hasText:"Pakistan"})).toBeVisible({timeout:30000});
 const structure=await checked(client.rpc("country_structure"));const pakistan=structure.countries.find(c=>c.name==="Pakistan").id;
 assert.equal(structure.assignments.find(p=>p.id===legacy).country_id,null);
 const canada=await checked(client.rpc("manage_country",{p_id:null,p_name:"Canada",p_delete:false}));
 const dup=await client.rpc("manage_country",{p_id:null,p_name:"pakistan",p_delete:false});assert.ok(dup.error);
 await checked(client.rpc("manage_country",{p_id:pakistan,p_name:"Pakistan QA",p_delete:false}));
 await expect(b.locator(".country-card").filter({hasText:"Pakistan QA"})).toBeVisible({timeout:30000});
 await a.goto(base+"/dash/countries/"+pakistan);
 await a.getByRole("button",{name:"New lead page",exact:true}).click();await a.getByLabel("Page name",{exact:true}).fill("Dentist Lahore");await a.getByRole("button",{name:"Create page",exact:true}).click();
 await expect(a.locator(".page-card").filter({hasText:"Dentist Lahore"})).toBeVisible({timeout:30000});
 const page=(await checked(client.from("lead_pages").select("id").eq("owner_id",owner).eq("name","Dentist Lahore")))[0].id;
await expect(a.locator(".page-card").filter({hasText:"Dentist Lahore"})).toBeVisible();
 await a.locator(".page-card").filter({hasText:"Dentist Lahore"}).getByRole("button",{name:"Move",exact:true}).click();await a.getByRole("combobox",{name:"Destination country"}).click();await a.getByRole("option",{name:"Canada",exact:true}).click();await a.getByRole("button",{name:"Move page",exact:true}).click();await expect(a.locator(".page-card").filter({hasText:"Dentist Lahore"})).toHaveCount(0,{timeout:30000});
 const request=randomUUID(),payload={p_request:request,p_page:null,p_new_name:"CSV QA",p_mode:"new",p_file:"qa.csv",p_rows:[{business_name:"Country Import QA",phone:"+12025550123"}],p_total:1,p_invalid:0};
 const batch=await checked(client.rpc("import_in_country",{p_country:pakistan,p_payload:payload}));
 let s=await checked(client.rpc("country_structure"));assert.equal(s.assignments.find(p=>p.id===batch.pageId).country_id,pakistan);
 await checked(client.rpc("move_country_page",{p_page:batch.pageId,p_country:canada}));await checked(client.rpc("import_in_country",{p_country:pakistan,p_payload:payload}));
 s=await checked(client.rpc("country_structure"));assert.equal(s.assignments.find(p=>p.id===batch.pageId).country_id,canada,"retry must not undo a later move");
 await checked(client.rpc("manage_country",{p_id:canada,p_name:"",p_delete:true}));
 s=await checked(client.rpc("country_structure"));assert.equal(s.assignments.find(p=>p.id===page).country_id,null);assert.equal(s.assignments.find(p=>p.id===batch.pageId).country_id,null);
 assert.equal((await checked(client.from("leads").select("id").eq("owner_id",owner))).length,1);
 const foreignAccount={email:`country-other-${randomUUID()}@example.invalid`,password:randomBytes(32).toString("base64url")};const foreignUser=(await checked(admin.auth.admin.createUser({...foreignAccount,email_confirm:true}))).user.id;extraUsers.push(foreignUser);const foreign=createClient(url,key,options);extraClients.push(foreign);await checked(foreign.auth.signInWithPassword(foreignAccount));
 assert.equal((await checked(foreign.rpc("country_structure"))).countries.length,0);assert.ok((await foreign.rpc("move_country_page",{p_page:page,p_country:pakistan})).error);
 await expect(b.locator(".country-card").filter({hasText:"Canada"})).toHaveCount(0,{timeout:30000});
 await b.screenshot({path:".local-test-output/countries-mobile.png",fullPage:true});await a.goto(base+"/dash/pages");await expect(a.locator(".country-card").filter({hasText:"Pakistan QA"})).toBeVisible({timeout:30000});await a.screenshot({path:".local-test-output/countries-desktop.png",fullPage:true});
 console.log("PASS: countries create and synchronize across sessions; existing pages remain unassigned; move, atomic imports, retry safety and folder deletion preserve pages/leads.");
} finally {
 await browser?.close();app?.kill();if(owner)await checked(admin.auth.admin.deleteUser(owner));for(const id of extraUsers)await checked(admin.auth.admin.deleteUser(id));for(const c of [admin,client,ssr,...extraClients]){await c.removeAllChannels();c.auth.stopAutoRefresh();c.realtime.disconnect();}
}
