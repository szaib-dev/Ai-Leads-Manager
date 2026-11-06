// Real hosted staging Auth + local browser application. No production target accepted.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
const ref='eygaxwoblnztuktpexpp',url=`https://${ref}.supabase.co`,base='http://127.0.0.1:3005';
const result=spawnSync('cmd.exe',['/d','/c','npx','--offline','supabase@3.0.0','projects','api-keys',`--remote=${ref}`,'--reveal','--output','json'],{encoding:'utf8',windowsHide:true});
assert.equal(result.status,0,'Staging API-key retrieval failed (contents withheld)');
const keys=JSON.parse(result.stdout);
const values=keys.map(k=>k.api_key).filter(Boolean);
const key=values.find(k=>k.startsWith('sb_publishable_'))||keys.find(k=>k.name==='anon')?.api_key;
const secret=values.find(k=>k.startsWith('sb_secret_'))||keys.find(k=>k.name==='service_role')?.api_key;
assert.ok(key&&secret,'Staging keys unavailable');
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(url,secret,options),session=createClient(url,key,options);
const email=`oauth-${randomUUID()}@example.com`,password=randomBytes(30).toString('base64url');
let uid,secondUid,oauthClientId,browser,app,tab;let callbackResolve;
const callback=new Promise(resolve=>callbackResolve=resolve);
const receiver=createServer((req,res)=>{callbackResolve(new URL(req.url,'http://127.0.0.1:3006'));res.end('Disposable OAuth test callback received.');});
async function check(response,label){assert.ok(response.ok,`${label}: HTTP ${response.status}`);return response.json();}
try{
 const user=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ok(!user.error,'Create disposable staging user failed');uid=user.data.user.id;
 const login=await session.auth.signInWithPassword({email,password});assert.ok(!login.error,'Normal password login failed');console.log('PASS normal hosted password login and unchanged token hook');
 const page=await session.rpc('manage_page',{p_id:null,p_name:'Disposable OAuth QA',p_description:'',p_delete:false});assert.ok(!page.error,'Create owned page failed');
 app=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3005'],{windowsHide:true,stdio:'ignore',env:{...process.env,NODE_ENV:'development',NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key,FOLIO_OAUTH_ENABLED:'true',FOLIO_OAUTH_RESOURCE:base+'/mcp'}});
 for(let i=0;i<90;i++){try{if((await fetch(base+'/login')).ok)break;}catch{}await new Promise(r=>setTimeout(r,1000));}
 await new Promise(r=>receiver.listen(3006,'127.0.0.1',r));
 const discovery=await check(await fetch(url+'/.well-known/oauth-authorization-server/auth/v1'),'discovery');
 const client=await check(await fetch(discovery.registration_endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Disposable Folio OAuth QA',redirect_uris:['http://127.0.0.1:3006/callback'],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'})}),'DCR');
 oauthClientId=client.client_id;
 const verifier=randomBytes(48).toString('base64url'),state=randomUUID();
 const authorize=new URL(discovery.authorization_endpoint);authorize.search=new URLSearchParams({client_id:client.client_id,redirect_uri:'http://127.0.0.1:3006/callback',response_type:'code',scope:'openid offline_access',state,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),resource:base+'/mcp'}).toString();
 browser=await chromium.launch({headless:true});tab=await browser.newPage();await tab.goto(authorize.href);
 await tab.getByLabel('Email address',{exact:true}).fill(email);await tab.getByLabel('Password',{exact:true}).fill(password);await tab.getByRole('button',{name:'Sign in',exact:true}).click();
 await tab.getByRole('heading',{name:'Connect to Folio'}).waitFor({timeout:60000});
 for(const box of await tab.locator('input[name="permissions"]').all())await box.check();
 await tab.getByRole('button',{name:'Allow selected permissions'}).click();
 const returned=await Promise.race([callback,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Consent callback timeout')),60000).unref())]);
 assert.equal(returned.searchParams.get('state'),state);assert.ok(returned.searchParams.get('code'),'No authorization code');
 const exchange=async body=>check(await fetch(discovery.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)}),'token exchange');
 const tokens=await exchange({grant_type:'authorization_code',client_id:client.client_id,code:returned.searchParams.get('code'),redirect_uri:'http://127.0.0.1:3006/callback',code_verifier:verifier,resource:base+'/mcp'});
 console.log('PASS browser login, consent, state, S256 code exchange');
 const refreshed=await exchange({grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token,resource:base+'/mcp'});console.log('PASS real refresh exchange');
 const rpc=async(method,params,token=refreshed.access_token)=>fetch(base+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method,...(params?{params}:{})})});
 await check(await rpc('initialize'),'MCP initialize');const tools=await check(await rpc('tools/list'),'MCP tools/list');assert.equal(tools.result.tools.length,13);console.log('PASS authenticated MCP initialize and all 13 tools');
 const call=async(action,data)=>{const r=await check(await rpc('tools/call',{name:'folio_'+action.replaceAll('.','_'),arguments:{data,idempotencyKey:randomUUID()}}),'tool '+action);assert.ok(!r.result.isError,'Tool failed: '+action);return JSON.parse(r.result.content[0].text).body.data;};
 await call('leads.create',{pageId:page.data,lead:{business_name:'Disposable OAuth Lead'}});
 const search=await check(await rpc('tools/call',{name:'folio_leads_search',arguments:{data:{query:'Disposable OAuth Lead'}}}),'search');const lead=JSON.parse(search.result.content[0].text).body.data[0];assert.ok(lead?.id);
 const updated=await call('leads.update',{id:lead.id,expectedUpdatedAt:lead.updated_at,changes:{notes:'Disposable staging verification'}});
 await call('meetings.create',{leadId:lead.id,expectedUpdatedAt:updated.updated_at,startsAt:'2030-12-01T10:00:00Z',timezone:'UTC'});console.log('PASS real OAuth lead create/read/update and meeting scheduling');
 for(const path of ['/rest/v1/leads?select=id','/rest/v1/rpc/integration_state']){const r=await fetch(url+path,{headers:{apikey:key,Authorization:`Bearer ${refreshed.access_token}`}});assert.ok([401,403,404].includes(r.status),'Direct Supabase privilege escalation');}console.log('PASS direct Supabase table and RPC denial');

 // A second disposable owner supplies a real foreign record; no production IDs are used.
 const secondPassword=randomBytes(30).toString('base64url'),secondEmail=`oauth-other-${randomUUID()}@example.com`;
 const second=await admin.auth.admin.createUser({email:secondEmail,password:secondPassword,email_confirm:true});assert.ok(!second.error);secondUid=second.data.user.id;
 const other=createClient(url,key,options);assert.ok(!(await other.auth.signInWithPassword({email:secondEmail,password:secondPassword})).error);
 const foreignPage=await other.rpc('manage_page',{p_id:null,p_name:'Other disposable owner',p_description:'',p_delete:false});assert.ok(!foreignPage.error);
 const foreignImport=await other.rpc('commit_import',{p_request:randomUUID(),p_page:foreignPage.data,p_new_name:null,p_mode:'append',p_file:'qa.csv',p_rows:[{business_name:'Foreign disposable lead'}],p_total:1,p_invalid:0});assert.ok(!foreignImport.error);
 const foreign=await other.from('leads').select('id').eq('page_id',foreignPage.data);assert.ok(!foreign.error);
 const cross=await check(await rpc('tools/call',{name:'folio_leads_get',arguments:{data:{id:foreign.data[0].id}}}),'cross-user test');assert.equal(JSON.parse(cross.result.content[0].text).status,404);console.log('PASS real cross-user OAuth access denied');
 // Existing dashboard CSV upload uses real server actions and staging Postgres.
 await tab.goto(base+'/dash/countries/unassigned');await tab.getByRole('button',{name:'Import CSV',exact:true}).click();
 await tab.getByLabel('CSV file',{exact:true}).setInputFiles({name:'disposable.csv',mimeType:'text/csv',buffer:Buffer.from('business_name,phone\nDisposable Browser CSV,123456789\n')});
 await expect.poll(async()=>await tab.getByRole('button',{name:'Review import',exact:true}).isVisible()||await tab.getByRole('button',{name:'View leads',exact:true}).isVisible(),{timeout:30000}).toBe(true);
 if(await tab.getByRole('button',{name:'Review import',exact:true}).isVisible()){await tab.getByRole('button',{name:'Review import',exact:true}).click();await tab.getByRole('button',{name:'Import leads',exact:true}).click();}
 await expect.poll(async()=>{const r=await session.from('leads').select('page_id').eq('business_name','Disposable Browser CSV');return r.data?.length||0;},{timeout:30000}).toBe(1);
 const csvDestination=await session.from('leads').select('page_id').eq('business_name','Disposable Browser CSV');await tab.goto(base+'/dash/pages/'+csvDestination.data[0].page_id);await expect(tab.locator('.business-cell').filter({hasText:'Disposable Browser CSV'})).toHaveCount(1,{timeout:30000});console.log('PASS real dashboard CSV upload, review, import and lead display');
 // Real API-key HTTP entry point and browser realtime refresh on an existing visible lead.
 const apiSecret='folio_'+randomBytes(32).toString('hex'),apiHash=createHash('sha256').update(apiSecret).digest('hex');
 const apiKey=await session.rpc('integration_manage_key',{p_id:null,p_name:'Disposable API key',p_scopes:['leads.read','leads.create','leads.update','leads.import','leads.archive','leads.delete','meetings.read','meetings.create','meetings.update','meetings.cancel','followups.create'],p_enabled:true,p_revoke:false,p_hash:apiHash,p_prefix:apiSecret.slice(0,14),p_expires:new Date(Date.now()+86400000).toISOString()});assert.ok(!apiKey.error);
 const api=async(action,data={})=>{const r=await fetch(base+'/api/v1/requests',{method:'POST',headers:{Authorization:`Bearer ${apiSecret}`,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({action,data})});assert.equal(r.status,200,'API key '+action);return r.json();};
 await api('pages.list');const listed=await api('leads.search',{query:'Disposable Browser CSV'});const csvLead=listed.data[0];assert.ok(csvLead);
 await api('leads.get',{id:csvLead.id});await api('leads.update',{id:csvLead.id,expectedUpdatedAt:csvLead.updated_at,changes:{business_name:'Disposable Realtime Updated'}});
 await expect(tab.locator('.business-cell').filter({hasText:'Disposable Realtime Updated'})).toHaveCount(1,{timeout:30000});console.log('PASS real API-key HTTP read/update and browser realtime delivery');

 await api('leads.create',{pageId:page.data,lead:{business_name:'Disposable API Matrix'}});
 await api('leads.import',{pageId:page.data,rows:[{business_name:'Disposable API Imported'}]});
 const matrix=(await api('leads.search',{query:'Disposable API Matrix'})).data[0];
 const meeting=await api('meetings.create',{leadId:matrix.id,expectedUpdatedAt:matrix.updated_at,startsAt:'2030-12-01T10:00:00Z',timezone:'UTC'});
 await api('meetings.list');
 const moved=await api('meetings.update',{id:meeting.data.id,leadId:matrix.id,expectedUpdatedAt:meeting.data.updated_at,startsAt:'2030-12-02T10:00:00Z',timezone:'UTC'});
 await api('meetings.cancel',{id:moved.data.id,leadId:matrix.id,expectedUpdatedAt:moved.data.updated_at});
 const imported=(await api('leads.search',{query:'Disposable API Imported'})).data[0];
 await api('followups.create',{leadId:imported.id,expectedUpdatedAt:imported.updated_at,startsAt:'2030-12-03T10:00:00Z',timezone:'UTC'});
 const afterCancel=(await api('leads.get',{id:matrix.id})).data;
 const archived=await api('leads.archive',{id:matrix.id,expectedUpdatedAt:afterCancel.updated_at});
 await api('leads.delete',{id:matrix.id,expectedUpdatedAt:archived.data.updated_at});
 console.log('PASS real API-key HTTP calls for all 13 actions');
 const grantState=await session.rpc('integration_state');const grant=grantState.data.keys.find(k=>k.name.startsWith('OAuth:'));
 const reduced=await session.rpc('integration_manage_key',{p_id:grant.id,p_name:null,p_scopes:['leads.read'],p_enabled:true,p_revoke:false,p_hash:null,p_prefix:null,p_expires:null});assert.ok(!reduced.error);
 assert.equal((await rpc('tools/call',{name:'folio_leads_create',arguments:{data:{pageId:page.data,lead:{business_name:'Must be denied'}}}})).status,403);console.log('PASS real reduced-permission token rejection');
 assert.equal((await rpc('tools/list',undefined,login.data.session.access_token)).status,401,'Normal token must not authorize MCP');
 const stateResult=await session.rpc('integration_state');const oauthKey=stateResult.data.keys.find(k=>k.name.startsWith('OAuth:'));
 const revoked=await session.rpc('integration_manage_key',{p_id:oauthKey.id,p_name:null,p_scopes:[],p_enabled:false,p_revoke:true,p_hash:null,p_prefix:null,p_expires:null});assert.ok(!revoked.error);
 assert.equal((await rpc('tools/list')).status,401);const afterRevoke=await exchange({grant_type:'refresh_token',client_id:client.client_id,refresh_token:refreshed.refresh_token,resource:base+'/mcp'});assert.equal((await rpc('tools/list',undefined,afterRevoke.access_token)).status,401);console.log('PASS revocation, refreshed-token denial and wrong-purpose token rejection');
}catch(error){console.error('FAIL',error.message.split('\n')[0].replaceAll(password,'[redacted]'));if(tab)console.error('Visible button labels:',await tab.getByRole('button').allTextContents().catch(()=>[]));process.exitCode=1;}
finally{if(browser)await browser.close();if(app){if(process.platform==='win32')spawnSync('taskkill',['/PID',String(app.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});else app.kill();}receiver.close();if(oauthClientId)await admin.auth.admin.oauth.deleteClient(oauthClientId);if(secondUid)await admin.auth.admin.deleteUser(secondUid);if(uid){const cleanup=await admin.auth.admin.deleteUser(uid);if(cleanup.error){console.error('Disposable staging user cleanup failed');process.exitCode=1;}}}
