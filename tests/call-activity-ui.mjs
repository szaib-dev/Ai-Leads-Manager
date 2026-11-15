// Local transport fixture only: UI behavior, not production authorization or latency.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { startWorkspaceFixture } from "./fixtures/workspace-backend.mjs";
const expect=baseExpect.configure({timeout:30000});
mkdirSync(".local-test-output", { recursive: true });
const fixture = await startWorkspaceFixture(), jar = new Map();
const base = "http://127.0.0.1:3009";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(fixture.url, fixture.adminKey, opts);
const ssr = createServerClient(fixture.url, fixture.key, { cookies: { getAll: () => [...jar].map(([name,value])=>({name,value})), setAll: values=>values.forEach(c=>jar.set(c.name,c.value)) } });
let app, browser, page, log = "";
const report = {};
try {
  const account={email:`design-${randomUUID()}@example.invalid`,password:randomUUID()};
  const user=await admin.auth.admin.createUser({...account,email_confirm:true}); assert.ok(user.data.user);
  const signed=await ssr.auth.signInWithPassword(account); assert.equal(signed.error,null);
  const seed=fixture.seedDesignFixtures();fixture.seedCities();
  app=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--webpack","--hostname","127.0.0.1","--port","3009"],{windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,NODE_ENV:"development",NEXT_PUBLIC_SUPABASE_URL:fixture.url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:fixture.key,DEEPSEEK_API_KEY:"local-fixture-proof-only-not-a-provider-key",NEXT_PUBLIC_PRIVATE_PATCHES:"false"}});
  app.stdout.on("data", b=>log=(log+b).slice(-5000));app.stderr.on("data", b=>log=(log+b).slice(-5000));
  for(let i=0;i<150;i++){if(app.exitCode!==null)throw new Error(log);try{if((await fetch(base+"/login")).ok)break;}catch{}await new Promise(r=>setTimeout(r,300));}
  browser=await chromium.launch({channel:"msedge"});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addCookies([...jar].map(([name,value])=>({name,value,url:base})));
  await context.addInitScript(()=>{if(!localStorage.getItem("theme"))localStorage.setItem("theme","dark");});
  page=await context.newPage();page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(60000);


  const statusNames=['no_answer','voicemail','interested','not_interested','callback_requested','meeting_booked','awaiting_callback','whatsapp'];
  const labels=['No Answer','Voicemail','Interested','Not Interested','Callback','Meeting Booked',"They'll Call Me Back",'Continue on WhatsApp'];
  const rows=await ssr.from('leads').insert(statusNames.map((status,i)=>({page_id:seed.pageId,business_name:`Call case ${status}`,phone:`+1202555020${i}`}))).select('id,updated_at');assert.equal(rows.error,null);
  await page.goto(base+'/dash/pages/'+seed.pageId);
  await page.evaluate(()=>{window.toastObservations=[];let prior=null,start=0;new MutationObserver(()=>{const node=document.querySelector('.toast');if(node!==prior){if(prior&&!node)window.toastObservations.push({duration:performance.now()-start});if(node){start=performance.now();const b=node.getBoundingClientRect();window.toastObservations.push({top:b.y,center:b.x+b.width/2,width:innerWidth});}prior=node;}}).observe(document.querySelector('.toast-region'),{subtree:true,childList:true});});
  for(let i=0;i<statusNames.length;i++){
    await page.getByRole('button',{name:`Record attempt for Call case ${statusNames[i]}`,exact:true}).click();
    await page.getByRole('radio',{name:labels[i],exact:true}).check();
    assert.equal((await ssr.rpc('calling_history_range')).data.total,i,'Choosing an outcome alone does not double count');
    await page.getByRole('button',{name:'Confirm attempt',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(async()=>(await ssr.rpc('calling_history_range')).data.total).toBe(i+1);
  }
  const history=(await ssr.rpc('calling_history_range')).data;assert.equal(history.total,8);assert.equal(new Set(history.rows.map(c=>c.outcome)).size,8);assert.ok(history.rows.every(c=>Number.isFinite(Date.parse(c.occurred_at))));report.allEightOutcomesDated=true;
  await expect.poll(()=>page.evaluate(()=>window.toastObservations.some(item=>item.duration>=900&&item.duration<1800)),{timeout:10000}).toBe(true);
  const observations=await page.evaluate(()=>window.toastObservations);for(const item of observations.filter(item=>'top'in item)){assert.ok(item.top<=20);assert.ok(Math.abs(item.center-item.width/2)<2);}report.toastTopCenterOneSecond=true;
  await page.goto(base+'/dash/attempts');await expect(page.getByRole('heading',{name:'Call attempts',exact:true})).toBeVisible();
  for(const label of ['No Answer','Voicemail','Interested','Not Interested','Callback Requested','Meeting Booked',"They'll Call Me Back",'Continued on WhatsApp'])await expect(page.locator('.activity-history').getByText(label,{exact:true})).toBeVisible();
  assert.equal(await page.locator('.activity-history time').count(),8);report.allAttemptsHistoryWithDates=true;
  await page.getByRole('button',{name:'Retry queue',exact:true}).click();await expect(page.getByRole('combobox',{name:'Status filter',exact:true})).toBeVisible();report.retryQueuePreserved=true;
  const state=(await ssr.rpc('workspace_state')).data, dental=state.pages.find(p=>p.name==='Dental clinics');
  await page.goto(base+'/dash/pages/'+dental.id);await page.getByText('Dental clinics new fixture',{exact:true}).click();await page.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByRole('dialog').getByRole('combobox').click();
  const green=await page.getByRole('option',{name:'Interested',exact:true}).evaluate(node=>getComputedStyle(node).color),red=await page.getByRole('option',{name:'Not Interested',exact:true}).evaluate(node=>getComputedStyle(node).color);
  const gc=green.match(/[\d.]+/g).map(Number),rc=red.match(/[\d.]+/g).map(Number);assert.ok(gc[1]>gc[0]);assert.ok(rc[0]>rc[1]);
  await page.getByRole('option',{name:'Interested',exact:true}).click();await page.getByRole('button',{name:'Save lead',exact:true}).click();await expect.poll(async()=>(await ssr.rpc('calling_history_range')).data.total).toBe(9);report.manualStatusCounts=true;
  await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('textbox',{name:'Business name',exact:true}).fill('Metadata only rename');await page.getByRole('button',{name:'Save lead',exact:true}).click();await expect(page.getByRole('heading',{name:'Metadata only rename',exact:true})).toBeVisible();assert.equal((await ssr.rpc('calling_history_range')).data.total,9);report.metadataDoesNotCount=true;report.redAndGreenStatusOptions=true;
  await page.keyboard.press('Escape');
  for(const theme of ['dark','light']){await page.evaluate(value=>localStorage.setItem('theme',value),theme);await page.setViewportSize({width:390,height:844});await page.goto(base+'/dash/attempts');await expect(page.locator('html')).toHaveClass(new RegExp(theme));await expect(page.locator('.activity-history time')).toHaveCount(9);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:`.local-test-output/call-history-${theme}-mobile.png`,fullPage:true});}
  report.lightDarkMobile=true;writeFileSync('.local-test-output/call-activity-ui-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){if(page)await page.screenshot({path:'.local-test-output/call-activity-failure.png',fullPage:true}).catch(()=>{});console.error(log);throw error;}
finally{if(browser)await browser.close();if(app&&app.exitCode===null){app.kill();await new Promise(r=>app.once('exit',r));}await fixture.close();}
