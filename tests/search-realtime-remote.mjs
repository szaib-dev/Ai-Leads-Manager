import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {chromium,expect} from '@playwright/test';
import {testAdminKey} from './fixtures/remote-admin-key.mjs';
const base=process.env.SEARCH_TEST_BASE||'https://ai-leads-manager-burak.vercel.app';
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const opts={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(url,testAdminKey(),opts),sdk=createClient(url,key,opts),jar=new Map();
const ssr=createServerClient(url,key,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:vs=>vs.forEach(c=>jar.set(c.name,c.value))}});
const report={base,timings:{}};let owner,browser;
async function checked(p){const r=await p;if(r.error)throw new Error(r.error.message);return r.data;}
try{
 const account={email:`search-qa-${randomUUID()}@example.invalid`,password:randomBytes(32).toString('base64url')};
 owner=(await checked(admin.auth.admin.createUser({...account,email_confirm:true}))).user.id;
 await checked(sdk.auth.signInWithPassword(account));await checked(ssr.auth.signInWithPassword(account));
 const imported=await checked(sdk.rpc('commit_import',{p_request:randomUUID(),p_page:null,p_new_name:'Search realtime QA',p_mode:'new',p_file:'fictional.csv',p_rows:[{business_name:'Phone Priority Fixture',phone:'+92 317 933 1234'},{business_name:'933 Name Fixture',phone:'555'},{business_name:'US Fragment Fixture',phone:'+1 (202) 933-1000'}],p_total:3,p_invalid:0}));
 browser=await chromium.launch(process.env.TEST_BROWSER_CHANNEL ? {channel:process.env.TEST_BROWSER_CHANNEL} : {});
 const contexts=await Promise.all([browser.newContext(),browser.newContext({viewport:{width:390,height:844}})]);
 for(const c of contexts)await c.addCookies([...jar].map(([name,value])=>({name,value,url:base})));
 const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));
 await a.goto(base+'/dash');await a.getByRole('button',{name:'Search all businesses',exact:true}).click();
 await expect(a.getByRole('heading',{name:'Search all businesses',exact:true})).toBeVisible({timeout:30000});
 await b.goto(base+'/dash/search');
 const inputA=a.getByRole('textbox',{name:'Search leads',exact:true}),inputB=b.getByRole('textbox',{name:'Search mobile leads',exact:true});
 await inputA.fill('0317933');await inputB.fill('0317933');
 const listA=a.getByRole('region',{name:'Desktop lead list'}),listB=b.getByRole('region',{name:'Mobile lead list'});
 await expect(listA.getByText('Phone Priority Fixture',{exact:true})).toBeVisible({timeout:30000});
 await expect(listB.getByText('Phone Priority Fixture',{exact:true})).toBeVisible({timeout:30000});
 await inputA.fill('933');await expect(listA.getByText('933 Name Fixture',{exact:true})).toBeVisible();
 const names=await listA.locator('button.business-cell strong').allTextContents();assert.equal(names.length,3);assert.equal(names.at(-1),'933 Name Fixture');
 await inputA.fill('Phone Priority');await expect(listA.getByText('Phone Priority Fixture',{exact:true})).toBeVisible();
 let lead=(await checked(sdk.from('leads').select('*').eq('owner_id',owner).eq('business_name','Phone Priority Fixture')))[0];
 // Time a committed database update to the independent mobile browser render.
 for(const status of ['interested','new']){
  const start=performance.now();await checked(sdk.rpc('save_lead',{p_id:lead.id,p_expected:lead.updated_at,p_data:{status},p_action:'edit'}));
  await expect(listB.getByText(status==='interested'?'Interested':'New',{exact:true})).toBeVisible({timeout:15000});
  report.timings[status+'RoundTripMs']=Math.round(performance.now()-start);
  lead=(await checked(sdk.from('leads').select('*').eq('id',lead.id)))[0];
 }
 await listA.getByText('Phone Priority Fixture',{exact:true}).click();await expect(a.getByRole('dialog')).toBeVisible();
 await a.keyboard.press('Escape');
 const start=performance.now();await checked(sdk.rpc('save_lead',{p_id:lead.id,p_expected:lead.updated_at,p_data:{},p_action:'delete'}));
 await expect(listB.getByText('Phone Priority Fixture',{exact:true})).toHaveCount(0,{timeout:15000});
 report.timings.deleteRoundTripMs=Math.round(performance.now()-start);
 report.search={header:true,localInternational:true,fragments:true,phoneFirst:true,name:true,openDetails:true};
 mkdirSync('.local-test-output',{recursive:true});writeFileSync('.local-test-output/search-realtime-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(browser)await browser.close();if(owner)await admin.auth.admin.deleteUser(owner);await sdk.removeAllChannels();await admin.removeAllChannels();}
