import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { chromium, expect } from '@playwright/test';
import { testAdminKey } from './fixtures/remote-admin-key.mjs';
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert.equal(new URL(url).hostname,'lypfxcohmsosedwptebu.supabase.co');
const base=process.env.WHATSAPP_TEST_BASE || 'https://ai-leads-manager-burak.vercel.app';
const opts={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(url,testAdminKey(),opts),sdk=createClient(url,key,opts), jar=new Map();
const ssr=createServerClient(url,key,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:values=>values.forEach(c=>jar.set(c.name,c.value))}});
let owner,browser; let pages=[]; const report={target:new URL(url).hostname,vercel:base,timings:{}};
async function checked(p){const r=await p;if(r.error)throw new Error(r.error.message);return r.data;}
async function record(){return (await checked(sdk.from('leads').select('*').eq('owner_id',owner))).find(l=>!l.deleted_at);}
try {
 const account={email:`whatsapp-qa-${randomUUID()}@example.invalid`,password:randomBytes(32).toString('base64url')};
 owner=(await checked(admin.auth.admin.createUser({...account,email_confirm:true}))).user.id;
 await checked(sdk.auth.signInWithPassword(account));await checked(ssr.auth.signInWithPassword(account));
 await checked(sdk.rpc('commit_import',{p_request:randomUUID(),p_page:null,p_new_name:'WhatsApp remote QA',p_mode:'new',p_file:'fictional.csv',p_rows:[{business_name:'Fictional WhatsApp QA',phone:'+12025550123',notes:'disposable verification fixture'}],p_total:1,p_invalid:0}));
 let lead=await record();
 browser=await chromium.launch();
 const contexts=await Promise.all([browser.newContext(),browser.newContext({viewport:{width:390,height:844}})]);
 for(const c of contexts)await c.addCookies([...jar].map(([name,value])=>({name,value,url:base})));
 const [a,b]=await Promise.all(contexts.map(c=>c.newPage())); pages=[a,b];
 const targets=new Set();for(const p of [a,b])p.on('request',r=>{try{const u=new URL(r.url());if(u.hostname.endsWith('.supabase.co'))targets.add(u.hostname);}catch{}});
 await b.goto(base+'/dash/whatsapp');
 await expect(b.getByRole('heading',{name:'WhatsApp Conversations',exact:true})).toBeVisible({timeout:30000});
 await a.goto(base+'/dash/pages/'+lead.page_id);
 await a.getByRole('button',{name:'Record attempt for Fictional WhatsApp QA',exact:true}).click();
 await a.getByText('Continue on WhatsApp',{exact:true}).click();
 // Use rendered submit text; print only bounded button labels if UI diverges.
 const buttons=await a.locator('[role="dialog"] button[type="submit"]').count();
 assert.equal(buttons,1,'one outcome submission');
 let start=performance.now();
 await a.locator('[role="dialog"] button[type="submit"]').click();
 await expect(b.getByRole('heading',{name:'Fictional WhatsApp QA',exact:true})).toBeVisible({timeout:30000});
 report.timings.handoffToSecondBrowserMs=Math.round(performance.now()-start);
 lead=await record();assert.equal(lead.status,'whatsapp');assert.equal(lead.whatsapp_status,'Waiting for Reply');
 assert.equal((await checked(sdk.from('call_attempts').select('id').eq('owner_id',owner))).length,0);
 report.outcomeDidNotCountAsCall=true;report.deployedSupabaseHosts=[...targets];
 await a.goto(base+'/dash/whatsapp');
 await expect(a.getByRole('heading',{name:'Fictional WhatsApp QA',exact:true})).toBeVisible({timeout:30000});
 console.log('PASS: outcome handoff reached both browsers',JSON.stringify(report));
 for(const status of ['In Conversation','Interested','Closed','Waiting for Reply']) {
   console.log('Testing status',status);
   await a.getByRole('combobox',{name:'Conversation status for Fictional WhatsApp QA'}).click();
   await a.getByRole('option',{name:status,exact:true}).click();
   await expect(a.getByRole('combobox',{name:'Conversation status for Fictional WhatsApp QA'})).toBeEnabled();
   await a.getByRole('button',{name:'Actions for Fictional WhatsApp QA'}).click();
   await a.getByRole('menuitem',{name:'Edit conversation',exact:true}).click();
   await a.locator('textarea').fill('Remote QA '+status);
   await a.locator('input[type=date]').fill('2026-11-05');
   start=performance.now();await a.getByRole('button',{name:'Save conversation',exact:true}).click();
   await expect(b.getByRole('combobox',{name:'Conversation status for Fictional WhatsApp QA'})).toContainText(status,{timeout:30000});
   report.timings[status+'CrossBrowserMs']=Math.round(performance.now()-start);
   await expect(a.getByRole('dialog')).toHaveCount(0);
   lead=await record();assert.equal(lead.whatsapp_status,status);assert.equal(lead.whatsapp_notes,'Remote QA '+status);assert.equal(lead.whatsapp_last_interaction,'2026-11-05');
 }
 lead=await record();
 await checked(sdk.rpc('save_lead',{p_id:lead.id,p_expected:lead.updated_at,p_data:{status:'follow_up',scheduled_date:'2026-11-06'},p_action:'edit'}));
 await expect(b.getByRole('heading',{name:'Fictional WhatsApp QA',exact:true})).toHaveCount(0,{timeout:30000});
 assert.equal((await checked(sdk.from('followups').select('id').eq('owner_id',owner).is('cancelled_at',null).is('completed_at',null))).length,1);
 lead=await record();await checked(sdk.rpc('manage_whatsapp',{p_id:lead.id,p_expected:lead.updated_at,p_status:'In Conversation',p_notes:'returned from followup',p_date:'2026-11-05'}));
 await expect(b.getByRole('heading',{name:'Fictional WhatsApp QA',exact:true})).toBeVisible({timeout:30000});
 await a.getByRole('button',{name:'Actions for Fictional WhatsApp QA'}).click();
 await a.getByRole('menuitem',{name:'Move to Archive',exact:true}).click();
 await expect(b.getByRole('heading',{name:'Fictional WhatsApp QA',exact:true})).toHaveCount(0,{timeout:30000});
 lead=await record();assert.ok(lead.archived_at);
 await checked(sdk.rpc('save_lead',{p_id:lead.id,p_expected:lead.updated_at,p_data:{},p_action:'restore'}));
 lead=await record();await checked(sdk.rpc('manage_whatsapp',{p_id:lead.id,p_expected:lead.updated_at,p_status:'Waiting for Reply',p_notes:'restored',p_date:null}));
 await expect(b.getByRole('heading',{name:'Fictional WhatsApp QA',exact:true})).toBeVisible({timeout:30000});
 lead=await record();
 const conflict=await sdk.rpc('manage_whatsapp',{p_id:lead.id,p_expected:'2020-01-01T00:00:00Z',p_status:'Closed',p_notes:'must not write',p_date:null});assert.ok(conflict.error);assert.equal((await record()).whatsapp_notes,'restored');
 await contexts[1].setOffline(true);
 lead=await record();await checked(sdk.rpc('manage_whatsapp',{p_id:lead.id,p_expected:lead.updated_at,p_status:'Interested',p_notes:'offline catchup',p_date:null}));
 await contexts[1].setOffline(false);
 await expect(b.getByRole('combobox',{name:'Conversation status for Fictional WhatsApp QA'})).toContainText('Interested',{timeout:30000});
 await b.route(base+'/dash/whatsapp',route=>route.request().method()==='POST'?route.abort('failed'):route.continue());
 await b.getByRole('combobox',{name:'Conversation status for Fictional WhatsApp QA'}).selectOption('Closed');
 await b.getByRole('button',{name:'Save conversation',exact:true}).click();
 await expect(b.getByRole('alert')).toBeVisible({timeout:30000});
 await expect(b.getByRole('combobox',{name:'Conversation status for Fictional WhatsApp QA'})).toContainText('Interested');
 assert.equal((await record()).whatsapp_status,'Interested');
 await b.unroute(base+'/dash/whatsapp');
 report.networkFailureRolledBack=true;
 lead=await record();await checked(sdk.rpc('save_lead',{p_id:lead.id,p_expected:lead.updated_at,p_data:{},p_action:'delete'}));
 await expect(b.getByRole('heading',{name:'Fictional WhatsApp QA',exact:true})).toHaveCount(0,{timeout:30000});
 assert.equal((await checked(sdk.from('call_attempts').select('id').eq('owner_id',owner))).length,0);
 report.twoAuthenticatedBrowsers=true;report.mobileViewport=true;report.statusesPersisted=true;report.followupArchiveRestoreDelete=true;report.reconnectCatchup=true;report.staleWriteRejected=true;
 console.log(JSON.stringify(report,null,2));
 writeFileSync('.local-test-output/whatsapp-remote-verified.json',JSON.stringify(report,null,2));
} catch(e) {
 for(const p of pages) console.log('QA page state',p.url(),(await p.locator('main').innerText().catch(()=>'' )).slice(0,3500));
 throw e;
} finally {
 await browser?.close();
 if(owner)await checked(admin.auth.admin.deleteUser(owner));
 for(const c of [sdk,ssr,admin]){await c.removeAllChannels();c.auth.stopAutoRefresh();c.realtime.disconnect();}
 console.log('Disposable QA account and fixtures removed.');
}