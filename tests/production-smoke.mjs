// HTTP-only production smoke test. Does not read personal sessions or simulate browser/device QA.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
const port=3002,base=`http://127.0.0.1:${port}`;
const probe=createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{windowsHide:true,env:{...process.env,NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});
let output='';app.stdout.on('data',s=>{output=(output+s).slice(-4000);});app.stderr.on('data',s=>{output=(output+s).slice(-4000);});
const closed=new Promise(resolve=>app.once('close',resolve));
try{
 const deadline=Date.now()+30000;let ready=false;
 while(Date.now()<deadline){assert.equal(app.exitCode,null,output);try{const r=await fetch(`${base}/login`,{signal:AbortSignal.timeout(2000)});if(r.ok){const html=await r.text();assert.ok(html.includes('type="password"'),'Production login must render its real form');ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}
 assert.ok(ready,`Production server did not become ready: ${output}`);
 const test=spawn(process.execPath,['tests/route-protection.mjs',base],{windowsHide:true,stdio:'inherit'});const code=await new Promise((resolve,reject)=>{test.once('error',reject);test.once('close',resolve);});assert.equal(code,0);console.log('PASS: current production build serves login and enforces all protected-route checks');
}finally{app.kill();await Promise.race([closed,new Promise(r=>setTimeout(r,3000))]);}
