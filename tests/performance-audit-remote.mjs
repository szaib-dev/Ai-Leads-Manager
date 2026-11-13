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
let owner,browser;
async function checked(p){const r=await p;if(r.error)throw new Error(r.error.message);return r.data;}
try{
 const account={email:`search-qa-${randomUUID()}@example.invalid`,password:randomBytes(32).toString('base64url')};
 owner=(await checked(admin.auth.admin.createUser({...account,email_confirm:true}))).user.id;
 await checked(sdk.auth.signInWithPassword(account));await checked(ssr.auth.signInWithPassword(account));
 await checked(sdk.rpc('commit_import',{p_request:randomUUID(),p_page:null,p_new_name:'Search realtime QA',p_mode:'new',p_file:'fictional.csv',p_rows:[{business_name:'Phone Priority Fixture',phone:'+92 317 933 1234'},{business_name:'933 Name Fixture',phone:'555'},{business_name:'US Fragment Fixture',phone:'+1 (202) 933-1000'}],p_total:3,p_invalid:0}));
 browser=await chromium.launch(process.env.TEST_BROWSER_CHANNEL ? {channel:process.env.TEST_BROWSER_CHANNEL} : {});
 const contexts=await Promise.all([browser.newContext(),browser.newContext({viewport:{width:390,height:844}})]);
 for(const c of contexts)await c.addCookies([...jar].map(([name,value])=>({name,value,url:base})));
 const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));
 const trace=[];let current=null;const starts=new Map();
 for(const [label,p] of [['desktop',a],['mobile',b]]){
 p.on('request',r=>{if(!r.url().includes('/_next/static'))starts.set(r,performance.now());});
 p.on('response',r=>{const req=r.request(),start=starts.get(req);if(start!==undefined){const u=new URL(r.url());if(u.hostname.endsWith('supabase.co')||req.method()==='POST')trace.push({browser:label,path:u.pathname,method:req.method(),ms:Math.round(performance.now()-start),at:performance.now()});}});
 p.on('websocket',ws=>ws.on('framereceived',frame=>{if(label==='mobile'&&current&&typeof frame.payload==='string'&&frame.payload.includes('revision')&&frame.payload.includes('workspace_sync'))current.websocketAt ??= performance.now();}));
 }
 const leads=await checked(sdk.from('leads').select('*').eq('owner_id',owner));let lead=leads.find(l=>l.business_name==='Phone Priority Fixture');
 const navigation=[];
 for(const path of ['/dash/pages','/dash/pages/'+lead.page_id,'/dash/attempts','/dash/search','/dash/pages/'+lead.page_id]){
 const start=performance.now();await a.goto(base+path);await a.locator('main h1').waitFor({state:'visible'});navigation.push({path:path.replace(lead.page_id,':collection'),documentToHeadingMs:Math.round(performance.now()-start)});
 }
 for(const [label,path] of [['Overview','/dash'],['Attempts','/dash/attempts'],['Lead pages','/dash/pages/'+lead.page_id]]){
 const start=performance.now();await a.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:label,exact:true}).click();await expect(a).toHaveURL(base+path);await a.locator('main h1').waitFor();navigation.push({type:'clientLink',path:path.replace(lead.page_id,':collection'),clickToHeadingMs:Math.round(performance.now()-start)});
 }
 console.log('Navigation measurements',JSON.stringify(navigation));
 await a.goto(base+'/dash/search');await b.goto(base+'/dash/search');
 await a.getByRole('textbox',{name:'Search all businesses',exact:true}).fill('0317933');await b.getByRole('textbox',{name:'Search all businesses',exact:true}).fill('0317933');
 const listA=a.getByRole('region',{name:'Search results'}),listB=b.getByRole('region',{name:'Search results'});
 await listA.getByText('Phone Priority Fixture',{exact:true}).waitFor();await listB.getByText('Phone Priority Fixture',{exact:true}).waitFor();
 const timings=[];
 for(const status of ['interested','new','interested','new']){
 current={status,start:performance.now()};const row=current;await checked(sdk.rpc('save_lead',{p_id:lead.id,p_expected:lead.updated_at,p_data:{status},p_action:'edit'}));row.responseAt=performance.now();
 await listB.getByText(status==='interested'?'Interested':'New',{exact:true}).waitFor();row.visibleAt=performance.now();
 timings.push({status,writeResponseMs:Math.round(row.responseAt-row.start),websocketMs:row.websocketAt?Math.round(row.websocketAt-row.start):null,visibleMs:Math.round(row.visibleAt-row.start)});
 lead=(await checked(sdk.from('leads').select('*').eq('id',lead.id)))[0];current=null;
 }
 await listA.getByText('Phone Priority Fixture',{exact:true}).click();await a.getByRole('dialog').waitFor();await a.getByRole('dialog').getByRole('button',{name:'Delete lead',exact:true}).click();
 const deletionStart=performance.now();await a.getByRole('button',{name:'Confirm delete',exact:true}).click();await listB.getByText('Phone Priority Fixture',{exact:true}).waitFor({state:'hidden'});const deletionMs=Math.round(performance.now()-deletionStart);
 console.log('Mutation measurements',JSON.stringify({timings,deletionMs}));
 async function sample(label,load){const values=[];for(let i=0;i<3;i++){const start=performance.now();await checked(load());values.push(Math.round(performance.now()-start));}return {label,samplesMs:values};}
 const reads=[];reads.push(await sample('workspace_leads_2_records',()=>sdk.rpc('workspace_leads',{p_page:lead.page_id,p_mode:'page',p_limit:15})));reads.push(await sample('workspace_state_2_records',()=>sdk.rpc('workspace_state')));
 await checked(sdk.rpc('commit_import',{p_request:randomUUID(),p_page:lead.page_id,p_mode:'append',p_new_name:null,p_file:'scale-fixture.csv',p_rows:Array.from({length:1000},(_,i)=>({business_name:'Scale Fixture '+i,phone:'+1202555'+String(i).padStart(4,'0')})),p_total:1000,p_invalid:0}));
 reads.push(await sample('workspace_leads_1002_records',()=>sdk.rpc('workspace_leads',{p_page:lead.page_id,p_mode:'page',p_limit:15})));reads.push(await sample('workspace_state_1002_records',()=>sdk.rpc('workspace_state')));
 const resources=await b.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('/_next/static/')&&r.name.includes('.js')).map(r=>({url:new URL(r.name).pathname,transferBytes:r.transferSize,decodedBytes:r.decodedBodySize})));
 const output={at:new Date().toISOString(),base,navigation,timings,deletionMs,reads,requests:trace.map(r=>({browser:r.browser,path:r.path,method:r.method,ms:r.ms})),resources,limits:'Single runner, two independent Chromium contexts; not physical phones; HTTP timings include network, observed visibility excludes input latency; three RPC samples per scale; synthetic owner only.'};
 mkdirSync('.local-test-output',{recursive:true});writeFileSync('.local-test-output/performance-audit.json',JSON.stringify(output,null,2));console.log(JSON.stringify({navigation,timings,deletionMs,reads,requests:trace.length,jsResources:resources.length}));
}finally{if(browser)await browser.close();if(owner)await admin.auth.admin.deleteUser(owner);await sdk.removeAllChannels();await admin.removeAllChannels();}
