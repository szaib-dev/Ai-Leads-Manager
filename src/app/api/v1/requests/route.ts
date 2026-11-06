import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {getSupabaseConfig} from "@/lib/supabase/config";
import {bearer,requestSchema} from "@/lib/integrations/contracts";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
export async function POST(request:Request){
 const requestId=request.headers.get("Idempotency-Key")||randomUUID();
 const reply=(status:number,code:string)=>Response.json({error:{code},requestId},{status,headers});
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId))return reply(400,"invalid_idempotency_key");
 const token=bearer(request.headers.get("Authorization"));if(!token)return reply(401,"invalid_api_key");
 if(!request.headers.get("Content-Type")?.includes("application/json"))return reply(415,"json_required");
 let raw:unknown;
 try{const reader=request.body?.getReader();if(!reader)return reply(400,"invalid_json");const chunks:Uint8Array[]=[];let size=0;while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>32768){await reader.cancel();return reply(413,"payload_too_large");}chunks.push(r.value);}raw=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{return reply(400,"invalid_json");}
 const p=requestSchema.safeParse(raw);if(!p.success)return reply(422,"invalid_request_fields");
 if(!["pages.list","leads.search","leads.get","meetings.list"].includes(p.data.action)&&!request.headers.has("Idempotency-Key"))return reply(400,"idempotency_key_required");
 const config=getSupabaseConfig();if(!config)return reply(503,"integration_unavailable");
 try{const client=createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});const r=await client.rpc("integration_request" as never,{p_token:token,p_action:p.data.action,p_payload:p.data.data,p_request:requestId} as never);if(r.error)return reply(503,"integration_unavailable");const result=r.data as unknown as {status:number;body:Record<string,unknown>};return Response.json({...result.body,requestId},{status:result.status,headers:{...headers,...(result.status===429?{"Retry-After":"60"}:{})}});}catch{return reply(503,"integration_unavailable");}
}
