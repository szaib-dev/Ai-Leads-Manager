import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdirSync} from 'node:fs';
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
 mkdirSync('.local-test-output',{recursive:true});
 browser=await chromium.launch(process.env.TEST_BROWSER_CHANNEL ? {channel:process.env.TEST_BROWSER_CHANNEL} : {});
 const contexts=await Promise.all([browser.newContext(),browser.newContext({viewport:{width:390,height:844}})]);
 for(const c of contexts)await c.addCookies([...jar].map(([name,value])=>({name,value,url:base})));
 const [,b]=await Promise.all(contexts.map(c=>c.newPage()));
 let patchJoined=false;const channelFrames=[];b.on('websocket',ws=>ws.on('framereceived',frame=>{if(typeof frame.payload==='string'){if(frame.payload.includes('lead-change'))channelFrames.push(frame.payload);try{const m=JSON.parse(frame.payload);if(m.topic==='realtime:lead-patches:'+owner&&m.event==='phx_reply'&&m.payload?.status==='ok')patchJoined=true;}catch{}}}));
 await b.goto(base+'/dash/search');const input=b.getByRole('textbox',{name:'Search all businesses',exact:true});await input.fill('0317933');const list=b.getByRole('region',{name:'Search results'});await list.getByText('Phone Priority Fixture',{exact:true}).waitFor();

 await expect.poll(()=>patchJoined,{timeout:15000}).toBe(true);
 // Prevent refetched records from masking a broken realtime patch transport.
 await b.route('**/rest/v1/rpc/workspace_leads',route=>route.abort());
 let lead=(await checked(sdk.from('leads').select('*').eq('owner_id',owner).eq('business_name','Phone Priority Fixture')))[0];
 for(const status of ['interested','new']){await checked(sdk.rpc('save_lead',{p_id:lead.id,p_expected:lead.updated_at,p_data:{status},p_action:'edit'}));await expect(list.getByText(status==='interested'?'Interested':'New',{exact:true})).toBeVisible({timeout:12000});lead=(await checked(sdk.from('leads').select('*').eq('id',lead.id)))[0];}
 assert.ok(channelFrames.length>=1,'Received committed private patch');for(const frame of channelFrames){assert.ok(!frame.includes('Phone Priority Fixture'));assert.ok(!frame.includes('+92 317'));}
 const otherAccount={email:`isolation-qa-${randomUUID()}@example.invalid`,password:randomBytes(32).toString('base64url')};let other;
 const otherId=(await checked(admin.auth.admin.createUser({...otherAccount,email_confirm:true}))).user.id;
 try{
 other=createClient(url,key,opts);await checked(other.auth.signInWithPassword(otherAccount));
 const status=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Authorization check timed out')),15000);other.channel('lead-patches:'+owner,{config:{private:true}}).on('broadcast',{event:'lead-change'},()=>reject(new Error('Cross-owner patch'))).subscribe(s=>{if(s==='SUBSCRIBED'||s==='CHANNEL_ERROR'){clearTimeout(timer);resolve(s);}});});
 assert.equal(status,'CHANNEL_ERROR','Another owner cannot subscribe to the private topic');
 }finally{if(other)await other.removeAllChannels();await admin.auth.admin.deleteUser(otherId);}
 await b.unroute('**/rest/v1/rpc/workspace_leads');console.log(JSON.stringify({privatePatchWithoutRefetch:true,noPrivateDetails:true,crossOwnerChannelDenied:true}));
}finally{if(browser)await browser.close();if(owner)await admin.auth.admin.deleteUser(owner);await sdk.removeAllChannels();await admin.removeAllChannels();}
