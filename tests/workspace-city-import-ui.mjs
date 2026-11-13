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
const base = "http://127.0.0.1:3007";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(fixture.url, fixture.adminKey, opts);
const ssr = createServerClient(fixture.url, fixture.key, { cookies: { getAll: () => [...jar].map(([name,value])=>({name,value})), setAll: values=>values.forEach(c=>jar.set(c.name,c.value)) } });
let app, browser, page, log = "";
const report = {};
try {
  const account={email:`design-${randomUUID()}@example.invalid`,password:randomUUID()};
  const user=await admin.auth.admin.createUser({...account,email_confirm:true}); assert.ok(user.data.user);
  const signed=await ssr.auth.signInWithPassword(account); assert.equal(signed.error,null);
  const seed=fixture.seedDesignFixtures();const location=fixture.seedCities();
  app=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--webpack","--hostname","127.0.0.1","--port","3007"],{windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,NODE_ENV:"development",NEXT_PUBLIC_SUPABASE_URL:fixture.url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:fixture.key,DEEPSEEK_API_KEY:"local-fixture-proof-only-not-a-provider-key",NEXT_PUBLIC_PRIVATE_PATCHES:"false"}});
  app.stdout.on("data", b=>log=(log+b).slice(-5000));app.stderr.on("data", b=>log=(log+b).slice(-5000));
  for(let i=0;i<150;i++){if(app.exitCode!==null)throw new Error(log);try{if((await fetch(base+"/login")).ok)break;}catch{}await new Promise(r=>setTimeout(r,300));}
  browser=await chromium.launch({channel:"msedge"});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addCookies([...jar].map(([name,value])=>({name,value,url:base})));
  await context.addInitScript(()=>{if(!localStorage.getItem("theme"))localStorage.setItem("theme","dark");});
  page=await context.newPage();page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(60000);

  const inViewport=async locator=>{const box=await locator.boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=(await page.viewportSize()).height,`Action outside viewport: ${JSON.stringify(box)}`);};
  await page.goto(base+'/dash/countries/'+location.country);
  const cards=page.locator('.collection-card');await expect(cards).toHaveCount(3);
  await expect(page.getByRole('combobox',{name:'Filter lead pages'})).toHaveCount(0);
  await expect(cards.getByRole('button',{name:'Reorder card'})).toHaveCount(0);
  await expect(cards.locator('svg.lucide-arrow-up-right')).toHaveCount(0);
  const first=await cards.first().getByRole('heading').innerText();
  const a=await cards.first().boundingBox(),b=await cards.nth(1).boundingBox();
  await page.mouse.move(a.x+20,a.y+90);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+90,{steps:12});await page.waitForTimeout(150);await page.mouse.up();
  await expect.poll(()=>cards.first().getByRole('heading').innerText()).not.toBe(first);await expect(page).toHaveURL(base+'/dash/countries/'+location.country);report.wholeCardMouseDrag=true;
  await page.getByRole('combobox',{name:'Sort lead pages'}).click();await page.getByRole('option',{name:'Most leads first'}).click();await expect(cards.first().getByRole('heading')).toHaveText('Salons');
  await page.getByRole('combobox',{name:'Sort lead pages'}).click();await page.getByRole('option',{name:'Fewest leads first'}).click();await expect(cards.first().getByRole('heading')).not.toHaveText('Salons');report.leadCountSorting=true;
  await page.getByRole('button',{name:'New city',exact:true}).click();await page.getByRole('textbox',{name:'City name',exact:true}).fill('Sector 9 - North');await page.getByRole('button',{name:'Save city',exact:true}).click();await expect(page.getByRole('heading',{name:'Sector 9 - North',exact:true})).toBeVisible();report.customCityCreated=true;
  const salons=cards.filter({has:page.getByRole('heading',{name:'Salons',exact:true})});await salons.getByRole('button',{name:'Move',exact:true}).click();
  await page.getByRole('combobox',{name:'Destination city',exact:true}).click();await page.getByRole('option',{name:'Mirpur',exact:true}).click();await page.getByRole('button',{name:'Move page',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(salons).toHaveCount(0);
  await page.locator('.city-card').filter({has:page.getByRole('heading',{name:'Mirpur',exact:true})}).getByRole('link').click();await expect(page).toHaveURL(base+'/dash/cities/'+location.city);await expect(cards.getByRole('heading',{name:'Salons',exact:true})).toBeVisible();report.pageMovedIntoCity=true;
  await page.getByRole('button',{name:'New lead page',exact:true}).click();await page.getByRole('textbox',{name:'Page name',exact:true}).fill('City clinics');await page.getByRole('button',{name:'Create page',exact:true}).click();await expect(cards.getByRole('heading',{name:'City clinics',exact:true})).toBeVisible();
  const assignments=(await ssr.rpc('country_structure')).data.assignments,state=(await ssr.rpc('workspace_state')).data;const cityPage=state.pages.find(p=>p.name==='City clinics');assert.equal(assignments.find(a=>a.id===cityPage.id).city_id,location.city);report.newPageInCity=true;
  await page.setViewportSize({width:1280,height:720});await page.getByRole('button',{name:'Import CSV',exact:true}).click();await expect(page.getByRole('combobox',{name:'Import city',exact:true})).toHaveText('Mirpur');await inViewport(page.getByRole('button',{name:'Review import',exact:true}));
  await page.screenshot({path:'.local-test-output/import-wizard-upload-dark.png'});
  await page.getByLabel('CSV file',{exact:true}).setInputFiles({name:'Mirpur clinics.csv',mimeType:'text/csv',buffer:Buffer.from('business_name,phone,google_maps_url\nCity import fixture,+12025550100,\n'.replaceAll('\\n','\n'))});
  await expect(page.getByRole('button',{name:'Review import',exact:true})).toBeEnabled();await inViewport(page.getByRole('button',{name:'Review import',exact:true}));await page.screenshot({path:'.local-test-output/import-wizard-columns-dark.png'});
  await page.getByRole('button',{name:'Review import',exact:true}).click();await expect(page.getByRole('button',{name:'Import leads',exact:true})).toBeEnabled();await inViewport(page.getByRole('button',{name:'Import leads',exact:true}));
  await page.setViewportSize({width:390,height:844});await inViewport(page.getByRole('button',{name:'Import leads',exact:true}));await page.screenshot({path:'.local-test-output/import-wizard-review-mobile.png'});
  await page.getByRole('button',{name:'Import leads',exact:true}).click();await expect(page.getByRole('heading',{name:'Import complete',exact:true})).toBeVisible();
  const finalState=(await ssr.rpc('workspace_state')).data,imported=finalState.pages.find(p=>p.name==='Mirpur clinics');assert.ok(imported);assert.equal((await ssr.rpc('country_structure')).data.assignments.find(a=>a.id===imported.id).city_id,location.city);report.cityImportAndFixedFooter=true;
  await page.getByRole('button',{name:'View leads',exact:true}).click();await page.setViewportSize({width:1280,height:720});await page.goto(base+'/dash/pages/'+seed.pageId);await page.getByRole('button',{name:'Record attempt for Salons new fixture',exact:true}).click();await inViewport(page.getByRole('button',{name:'Confirm attempt',exact:true}));
  await page.setViewportSize({width:390,height:844});await inViewport(page.getByRole('button',{name:'Confirm attempt',exact:true}));await page.screenshot({path:'.local-test-output/call-footer-mobile.png'});await page.keyboard.press('Escape');report.callFooterAlwaysVisible=true;
  await page.goto(base+'/dash/ai');await page.getByRole('button',{name:'Toggle chat history',exact:true}).click();await expect(page.getByRole('complementary',{name:'Chat history',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close chat history',exact:true}).first().click();await page.waitForTimeout(280);await expect(page.getByRole('complementary',{name:'Chat history',exact:true})).toHaveCount(0);report.chatHistoryTransition=true;
  fixture.seedFolderPlan(seed.chatId,cityPage.id,location.city);await page.goto(base+'/dash/ai?chat='+seed.chatId);await page.getByRole('button',{name:'Approve folder move',exact:true}).click();await expect(page.getByRole('button',{name:'Approve folder move',exact:true})).toHaveCount(0);report.chatFolderApproval=true;
  for(const theme of ['dark','light']){await page.evaluate(value=>localStorage.setItem('theme',value),theme);await page.goto(base+'/dash/cities/'+location.city);await page.waitForLoadState('networkidle');await expect(page.locator('html')).toHaveClass(new RegExp(theme));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:`.local-test-output/cities-${theme}-mobile.png`,fullPage:true});}
  report.lightDarkMobile=true;writeFileSync('.local-test-output/city-import-ui-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} catch(error){if(page)await page.screenshot({path:'.local-test-output/city-import-failure.png',fullPage:true}).catch(()=>{});console.error(log);throw error;}
finally {if(browser)await browser.close();if(app&&app.exitCode===null){app.kill();await new Promise(r=>app.once('exit',r));}await fixture.close();}
