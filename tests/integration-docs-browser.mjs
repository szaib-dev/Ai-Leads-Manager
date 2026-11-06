import {spawn} from "node:child_process";
import assert from "node:assert/strict";
import {chromium,expect} from "@playwright/test";
const base="http://127.0.0.1:3032";
const app=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","3032"],{windowsHide:true,stdio:"ignore"});let browser;
try{
 await expect.poll(async()=>{try{return(await fetch(base+"/docs/integrations",{redirect:"manual"})).status}catch{return 0}},{timeout:30000}).toBe(200);
 browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:["clipboard-read","clipboard-write"]});const page=await context.newPage();
 await page.goto(base+"/docs/integrations");await expect(page.getByRole("heading",{level:1})).toContainText("Connected to Folio");await expect(page.locator('article[id]')).toHaveCount(13);
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);for(const theme of ["light","dark"]){await page.evaluate(theme=>document.documentElement.classList.toggle("dark",theme==="dark"),theme);await page.screenshot({path:`.local-test-output/docs-${theme}-${width}.png`});}}
 const search=page.getByRole("textbox",{name:"Search integration actions"});await search.fill("meetings.cancel");await expect(page.locator('article[id]')).toHaveCount(1);await expect(page.getByRole("heading",{name:"Cancel a meeting",exact:true})).toBeVisible();await search.fill("");await expect(page.locator('article[id]')).toHaveCount(13);
 const sample=page.locator('article[id="leads.create"]');await sample.getByRole("button",{name:"Copy code"}).click();const copied=await page.evaluate(()=>navigator.clipboard.readText());assert.equal(JSON.parse(copied).action,"leads.create");
 await search.fill("not-a-real-action");await expect(page.getByText("No actions match.",{exact:false})).toBeVisible();await page.getByRole("button",{name:"Clear search"}).click();await expect(page.locator('article[id]')).toHaveCount(13);
 assert.equal((await fetch(base+"/api/v1/requests",{method:"POST"})).status,401);
 console.log("PASS: public unauthenticated docs, all actions, search/empty state, copyable JSON, light/dark desktop/tablet/320px/mobile layout. Protected API still requires a secret.");
}finally{await browser?.close();app.kill();}
