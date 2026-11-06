import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {z} from "zod";
import {documentedActions} from "@/lib/integrations/documentation";
import {bearer, requestSchema} from "@/lib/integrations/contracts";
import {oauthConfig, oauthEnabled, verifyOAuth} from "@/lib/integrations/oauth";
import {getSupabaseConfig} from "@/lib/supabase/config";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
function challenge(status=401) {
  const resource=oauthEnabled()?oauthConfig().resource:null;
  return Response.json({error:status===403?"insufficient_scope":"invalid_token"},{status,headers:{...headers,...(resource?{"WWW-Authenticate":`Bearer resource_metadata="${new URL(resource).origin}/.well-known/oauth-protected-resource/mcp", error="${status===403?"insufficient_scope":"invalid_token"}"`}:{})}});
}
export async function POST(request:Request) {
  if(request.headers.has("Origin") && request.headers.get("Origin")!==new URL(request.url).origin) return new Response(null,{status:403,headers});
  const token=/^Bearer ([^\s]+)$/i.exec(request.headers.get("Authorization")||"")?.[1];
  if(!token)return challenge();
  const apiKey=bearer(request.headers.get("Authorization"));
  if(!apiKey) {
    if(!oauthEnabled())return challenge();
    try{await verifyOAuth(token,oauthConfig());}catch{return challenge();}
  }
  const config=getSupabaseConfig();if(!config)return new Response(null,{status:503,headers});
  const client=createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:apiKey?{}:{Authorization:`Bearer ${token}`}}});
  async function execute(action:string,data:unknown,id:string) {
    const result=await client.rpc(apiKey?"integration_request":"folio_oauth_request",{...(apiKey?{p_token:apiKey}:{}),p_action:action,p_payload:data,p_request:id});
    if(result.error)throw new Error("Integration unavailable");
    return result.data as {status:number;body:unknown};
  }
  try {
    // Authenticate discovery as well as calls. A missing read permission is still an authenticated principal.
    const auth=await execute("pages.list",{},randomUUID());
    if(auth.status===401)return challenge();
    if(auth.status===403 && !JSON.stringify(auth.body).includes("permission_disabled"))return challenge(403);
    if(auth.status===429)return Response.json(auth.body,{status:429,headers:{...headers,"Retry-After":"60"}});
    if(!request.headers.get("Content-Type")?.includes("application/json"))return new Response(null,{status:415,headers});
    const reader=request.body?.getReader();if(!reader)return new Response(null,{status:400,headers});
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>32768){await reader.cancel();return new Response(null,{status:413,headers});}chunks.push(r.value);}
    let raw:unknown;
    try {raw=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{return Response.json({jsonrpc:"2.0",id:null,error:{code:-32700,message:"Parse error"}},{status:400,headers});}
    const parsed=z.object({jsonrpc:z.literal("2.0"),id:z.union([z.string(),z.number()]).optional(),method:z.string(),params:z.unknown().optional()}).safeParse(raw);
    if(!parsed.success)return Response.json({jsonrpc:"2.0",id:null,error:{code:-32600,message:"Invalid request"}},{status:400,headers});
    const msg=parsed.data;
    const reply=(result:unknown)=>Response.json({jsonrpc:"2.0",id:msg.id,result},{headers});
    if(msg.id===undefined)return new Response(null,{status:202,headers});
    if(msg.method==="initialize")return reply({protocolVersion:"2025-11-25",capabilities:{tools:{listChanged:false}},serverInfo:{name:"folio-lead-manager",version:"1.0.0"},instructions:"Search and read exact IDs and updated_at before edits. Never infer an ID from a business name. No phone-call attempt logging is supported."});
    if(msg.method==="ping")return reply({});
    if(msg.method==="tools/list")return reply({tools:requestSchema.options.map(option=>({name:"folio_"+option.shape.action.value.replaceAll(".","_"),annotations:{readOnlyHint:["pages.list","leads.search","leads.get","meetings.list"].includes(option.shape.action.value),destructiveHint:["leads.delete","leads.archive","meetings.cancel"].includes(option.shape.action.value),openWorldHint:false},description:documentedActions.find(entry=>entry.request.action===option.shape.action.value)!.description+" Use current updated_at for concurrency. Reuse the returned idempotencyKey for retries.",inputSchema:{type:"object",properties:{data:z.toJSONSchema(option.shape.data),idempotencyKey:{type:"string",format:"uuid"}},required:["data"],additionalProperties:false}}))});
    if(msg.method==="tools/call") {
      const p=z.object({name:z.string(),arguments:z.object({data:z.unknown(),idempotencyKey:z.uuid().optional()}).strict()}).strict().safeParse(msg.params);
      if(p.success){
        const action=p.data.name.replace(/^folio_/,"").replaceAll("_",".");const input=requestSchema.safeParse({action,data:p.data.arguments.data});
        if(input.success){
          const read=["pages.list","leads.search","leads.get","meetings.list"].includes(action);
          if(read&&p.data.arguments.idempotencyKey)return Response.json({jsonrpc:"2.0",id:msg.id,error:{code:-32602,message:"Read action cannot have an idempotency key"}},{headers});
          const requestId=p.data.arguments.idempotencyKey||randomUUID();
          const result=await execute(action,input.data.data,requestId);
          if(result.status===401)return challenge();if(result.status===403)return challenge(403);
          return reply({isError:result.status!==200,content:[{type:"text",text:JSON.stringify({status:result.status,body:result.body,...(!read?{idempotencyKey:requestId}:{})})}]});
        }
      }
      return Response.json({jsonrpc:"2.0",id:msg.id,error:{code:-32602,message:"Invalid tool arguments"}},{headers});
    }
    return Response.json({jsonrpc:"2.0",id:msg.id,error:{code:-32601,message:"Method not found"}},{headers});
  }catch{return Response.json({error:"integration_unavailable"},{status:503,headers});}
}
export async function DELETE(){return new Response(null,{status:405,headers:{...headers,Allow:"POST"}});}
export async function GET(){return new Response(null,{status:405,headers:{...headers,Allow:"POST"}});}
