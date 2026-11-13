// Local transport fixture only: UI behavior, not production authorization or latency.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { startWorkspaceFixture } from "./fixtures/workspace-backend.mjs";
mkdirSync(".local-test-output", { recursive: true });
const fixture = await startWorkspaceFixture(), jar = new Map();
const base = "http://127.0.0.1:3006";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(fixture.url, fixture.adminKey, opts);
const ssr = createServerClient(fixture.url, fixture.key, { cookies: { getAll: () => [...jar].map(([name,value])=>({name,value})), setAll: values=>values.forEach(c=>jar.set(c.name,c.value)) } });
let app, browser, page, log = "";
const report = {};
try {
  const account={email:`design-${randomUUID()}@example.invalid`,password:randomUUID()};
  const user=await admin.auth.admin.createUser({...account,email_confirm:true}); assert.ok(user.data.user);
  const signed=await ssr.auth.signInWithPassword(account); assert.equal(signed.error,null);
  const seed=fixture.seedDesignFixtures();
  app=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--webpack","--hostname","127.0.0.1","--port","3006"],{windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,NODE_ENV:"development",NEXT_PUBLIC_SUPABASE_URL:fixture.url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:fixture.key,DEEPSEEK_API_KEY:"",NEXT_PUBLIC_PRIVATE_PATCHES:"false"}});
  app.stdout.on("data", b=>log=(log+b).slice(-5000));app.stderr.on("data", b=>log=(log+b).slice(-5000));
  for(let i=0;i<150;i++){if(app.exitCode!==null)throw new Error(log);try{if((await fetch(base+"/login")).ok)break;}catch{}await new Promise(r=>setTimeout(r,300));}
  browser=await chromium.launch({channel:"msedge"});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addCookies([...jar].map(([name,value])=>({name,value,url:base})));
  await context.addInitScript(()=>{if(!localStorage.getItem("theme"))localStorage.setItem("theme","dark");});
  page=await context.newPage();page.setDefaultTimeout(20000);
  await page.goto(base+"/dash/pages/"+seed.pageId);await expect(page.getByRole("combobox",{name:"Status filter",exact:true})).toHaveText("New");
  await expect(page.getByText("Salons new fixture",{exact:true})).toBeVisible();await expect(page.getByText("Follow-up fixture 1",{exact:true})).toHaveCount(0);report.defaultNew=true;
  await expect(page.locator('.header-search-trigger kbd')).toHaveCount(0);report.searchHintRemoved=true;
  await page.goto(base+"/dash/countries/unassigned");
  const cards=page.locator('.collection-card');await expect(cards).toHaveCount(3);
  const first=await cards.first().getByRole('heading').innerText();
  await cards.first().focus();await page.keyboard.press('Space');await expect(page.locator('[data-dragging=true]')).toHaveCount(1);await page.waitForTimeout(200);await page.keyboard.press('ArrowRight');await page.waitForTimeout(200);await page.keyboard.press('Space');
  await expect.poll(()=>cards.first().getByRole('heading').innerText()).not.toBe(first);
  const newFirst=await cards.first().getByRole('heading').innerText();await page.reload();await expect(cards.first().getByRole('heading')).toHaveText(newFirst);report.pageOrderPersists=true;
  await page.screenshot({path:'.local-test-output/redesign-pages-dark.png',fullPage:true});
  await page.goto(base+"/dash/activity");await expect(page.getByRole('region',{name:'Activity overview'})).toBeVisible();
  await expect(page.getByText('Every outcome counts',{exact:true})).toBeVisible();
  const metric=page.locator('[class*="metricCard"]');const metricFirst=await metric.first().innerText();await metric.first().getByRole('button',{name:'Reorder card'}).focus();await page.keyboard.press('Space');await expect(page.locator('[data-dragging=true]')).toHaveCount(1);await page.waitForTimeout(200);await page.keyboard.press('ArrowRight');await page.waitForTimeout(200);await page.keyboard.press('Space');await expect.poll(()=>metric.first().innerText()).not.toBe(metricFirst);report.activityReorder=true;
  await page.screenshot({path:'.local-test-output/redesign-activity-dark.png',fullPage:true});
  await page.goto(base+"/dash/followups");await expect(page.getByRole('article',{name:'Follow-up for Follow-up fixture 1',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Change status for Follow-up fixture 1',exact:true}).click();await page.getByRole('combobox',{name:'Lead status',exact:true}).click();await page.getByRole('option',{name:'Interested',exact:true}).click();await page.getByRole('button',{name:'Save status',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('article',{name:'Follow-up for Follow-up fixture 1',exact:true})).toHaveCount(0);report.followupStatus=true;
  await page.getByRole('button',{name:'Remove follow-up for Follow-up fixture 2',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Remove follow-up',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('article',{name:'Follow-up for Follow-up fixture 2',exact:true})).toHaveCount(0);report.removeReminder=true;
  await page.getByRole('button',{name:'Follow-up actions for Follow-up fixture 3',exact:true}).click();await page.getByRole('menuitem',{name:'Delete lead…',exact:true}).click();await page.getByRole('button',{name:'Delete lead',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('article',{name:'Follow-up for Follow-up fixture 3',exact:true})).toHaveCount(0);report.deleteLead=true;
  await page.goto(base+"/dash/ai");await expect(page.getByRole('heading',{name:'What’s next for your leads?',exact:true})).toBeVisible();await expect(page.getByText('No data returned. Please retry.',{exact:true})).toHaveCount(0);report.newChatNoFalseError=true;
  await page.goto(base+"/dash/ai?chat="+seed.chatId);await expect(page.getByRole('region',{name:'Database operation'}).first()).toBeVisible();await expect(page.getByRole('button',{name:'Review undo',exact:true})).toHaveCount(0);
  const bounds=await page.evaluate(()=>{const text=document.querySelector('[class*="answer"] [class*="markdown"]').getBoundingClientRect(),card=document.querySelector('[aria-label="Database operation"]').getBoundingClientRect();return {text:{x:text.x,width:text.width},card:{x:card.x,width:card.width}};});assert.ok(Math.abs(bounds.text.x-bounds.card.x)<2);assert.ok(Math.abs(bounds.text.width-bounds.card.width)<2);report.chatAligned=true;report.zeroRecordUndoHidden=true;
  await page.screenshot({path:'.local-test-output/redesign-chat-dark.png',fullPage:true});
  for(const theme of ['dark','light']){
    await page.evaluate(value=>localStorage.setItem('theme',value),theme);
    await page.setViewportSize({width:390,height:844});
    for(const route of ['/dash/activity','/dash/followups','/dash/ai?chat='+seed.chatId]){
      await page.goto(base+route);await page.waitForLoadState('networkidle');
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,`${theme} ${route} overflow`);
      await page.screenshot({path:`.local-test-output/redesign-${route.includes('ai?')?'chat':route.split('/').at(-1)}-${theme}-mobile.png`,fullPage:true});
    }
  }
  report.lightDarkMobileNoPageOverflow=true;writeFileSync('.local-test-output/redesign-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} catch(error){if(page)await page.screenshot({path:'.local-test-output/redesign-failure.png',fullPage:true}).catch(()=>{});console.error(log);throw error;}
finally {if(browser)await browser.close();if(app && app.exitCode===null){app.kill();await new Promise(r=>app.once('exit',r));}await fixture.close();}
