// Local transport fixture only: UI behavior, not production authorization or latency.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { startWorkspaceFixture } from "./fixtures/workspace-backend.mjs";
const expect=baseExpect.configure({timeout:30000});
mkdirSync(".local-test-output", { recursive: true });
const fixture = await startWorkspaceFixture(), jar = new Map();
const base = "http://127.0.0.1:3008";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(fixture.url, fixture.adminKey, opts);
const ssr = createServerClient(fixture.url, fixture.key, { cookies: { getAll: () => [...jar].map(([name,value])=>({name,value})), setAll: values=>values.forEach(c=>jar.set(c.name,c.value)) } });
let app, browser, page, log = "";
try {
  const account={email:`design-${randomUUID()}@example.invalid`,password:randomUUID()};
  const user=await admin.auth.admin.createUser({...account,email_confirm:true}); assert.ok(user.data.user);
  const signed=await ssr.auth.signInWithPassword(account); assert.equal(signed.error,null);
  const seed=fixture.seedDesignFixtures();const location=fixture.seedCities();
  app=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--webpack","--hostname","127.0.0.1","--port","3008"],{windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,NODE_ENV:"development",NEXT_PUBLIC_SUPABASE_URL:fixture.url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:fixture.key,DEEPSEEK_API_KEY:"local-fixture-proof-only-not-a-provider-key",NEXT_PUBLIC_PRIVATE_PATCHES:"false"}});
  app.stdout.on("data", b=>log=(log+b).slice(-5000));app.stderr.on("data", b=>log=(log+b).slice(-5000));
  for(let i=0;i<150;i++){if(app.exitCode!==null)throw new Error(log);try{if((await fetch(base+"/login")).ok)break;}catch{}await new Promise(r=>setTimeout(r,300));}
  browser=await chromium.launch({channel:"msedge"});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addCookies([...jar].map(([name,value])=>({name,value,url:base})));
  await context.addInitScript(()=>{if(!localStorage.getItem("theme"))localStorage.setItem("theme","dark");});
  page=await context.newPage();page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(60000);


  await ssr.rpc('move_page_location',{p_page:seed.pageId,p_country:location.country,p_city:location.city});
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+"/dash/cities/"+location.city);
  for(const theme of ['dark','light']){
    await page.evaluate(value=>localStorage.setItem('theme',value),theme);await page.goto(base+'/dash/cities/'+location.city);await expect(page.locator('html')).toHaveClass(new RegExp(theme));await expect(page.getByRole('heading',{name:'Salons',exact:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.screenshot({path:`.local-test-output/cities-${theme}-mobile.png`,fullPage:true});
  }
  console.log(JSON.stringify({actualLightAndDarkThemes:true,mobileNoOverflow:true}));
}catch(error){console.error(log);throw error;}
finally{if(browser)await browser.close();if(app&&app.exitCode===null){app.kill();await new Promise(r=>app.once('exit',r));}await fixture.close();}
