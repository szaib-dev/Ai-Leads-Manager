import {randomUUID} from "node:crypto";
import {POST as folioRequest} from "@/app/api/v1/requests/route";
import {bearer,requestSchema} from "@/lib/integrations/contracts";
import {documentedActions} from "@/lib/integrations/documentation";

export const runtime="nodejs";
export const dynamic="force-dynamic";

// Stateless JSON-response MCP Streamable HTTP bridge. No token is stored here.
// Folio's existing API enforces permission scopes, owner isolation, rate limits,
// optimistic concurrency, idempotency, and audit logging.
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",Vary:"Authorization"};
type RecordValue=Record<string,unknown>;
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers});
const success=(id:unknown,result:unknown)=>reply({jsonrpc:"2.0",id,result});
const failure=(id:unknown,code:number,message:string)=>reply({jsonrpc:"2.0",id:id??null,error:{code,message}});
const names=new Map(documentedActions.map(entry=>["folio_"+entry.request.action.replaceAll(".","_"),entry]));

export async function POST(request:Request):Promise<Response>{
  const auth=request.headers.get("Authorization");
  if(!bearer(auth)) return reply({error:"invalid_api_key"},401);
  if(!request.headers.get("Content-Type")?.includes("application/json")) return reply({error:"json_required"},415);
  let packet:RecordValue;
  try{
    const raw=await request.text();
    if(Buffer.byteLength(raw,"utf8")>40000)return reply({error:"payload_too_large"},413);
    const value:unknown=JSON.parse(raw);
    if(!value||typeof value!=="object"||Array.isArray(value))return failure(null,-32600,"Invalid JSON-RPC request");
    packet=value as RecordValue;
  }catch{return failure(null,-32700,"Parse error");}
  const id=packet.id??null;
  if(packet.jsonrpc!=="2.0"||typeof packet.method!=="string")return failure(id,-32600,"Invalid JSON-RPC request");
  if(packet.method==="notifications/initialized"||packet.method==="notifications/cancelled")return new Response(null,{status:202,headers});
  if(packet.method==="initialize")return success(id,{
    protocolVersion:"2025-06-18",
    capabilities:{tools:{listChanged:false}},
    serverInfo:{name:"folio-lead-manager",version:"0.1.0"},
    instructions:"Manage Folio leads, lead pages, meetings and follow-ups. Search and read exact IDs and updated_at before edits. Never infer an ID from a business name. No phone-call attempt logging is supported."
  });
  if(packet.method==="ping")return success(id,{});
  if(packet.method==="tools/list")return success(id,{tools:documentedActions.map(entry=>({
    name:"folio_"+entry.request.action.replaceAll(".","_"),
    title:entry.title,
    description:entry.description+" Permission: "+entry.scope+". Fields: "+entry.fields.join("; ")+". Example: "+JSON.stringify(entry.request.data)+". Result: "+entry.result,
    inputSchema:{type:"object",properties:{data:{type:"object",description:"Data object for the action, as shown in the example"},...(entry.write?{idempotencyKey:{type:"string",format:"uuid",description:"Optional UUID; reuse only when retrying exactly the same write"}}:{})},required:["data"],additionalProperties:false},
    annotations:{readOnlyHint:!entry.write,destructiveHint:["leads.delete","leads.archive","meetings.cancel"].includes(entry.request.action),openWorldHint:false}
  }))});
  if(packet.method!=="tools/call")return failure(id,-32601,"Method not found");
  const params=packet.params;
  if(!params||typeof params!=="object"||Array.isArray(params))return failure(id,-32602,"Invalid tool parameters");
  const {name,arguments:args} = params as {name?:unknown;arguments?:unknown};
  const entry=typeof name==="string"?names.get(name):undefined;
  if(!entry)return failure(id,-32602,"Unknown Folio tool");
  if(!args||typeof args!=="object"||Array.isArray(args))return failure(id,-32602,"Invalid tool arguments");
  const {data,idempotencyKey,...unexpected}=args as RecordValue;
  if(Object.keys(unexpected).length||!data||typeof data!=="object"||Array.isArray(data))return failure(id,-32602,"Expected a data object");
  if(idempotencyKey!==undefined&&!entry.write)return failure(id,-32602,"Read action cannot have an idempotency key");
  if(idempotencyKey!==undefined&&(typeof idempotencyKey!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(idempotencyKey)))return failure(id,-32602,"Invalid idempotency key");
  const validated=requestSchema.safeParse({action:entry.request.action,data});
  if(!validated.success)return success(id,{content:[{type:"text",text:JSON.stringify({error:"invalid_request_fields",issues:validated.error.issues.map(issue=>({path:issue.path.join("."),message:issue.message}))})}],isError:true});
  const retryKey=entry.write?(idempotencyKey as string|undefined)??randomUUID():null;
  try{
    const upstream=await folioRequest(new Request("https://folio.internal/api/v1/requests",{method:"POST",headers:{"Content-Type":"application/json",Authorization:auth!,...(retryKey?{"Idempotency-Key":retryKey}:{})},body:JSON.stringify(validated.data)}));
    const payload:unknown=await upstream.json();
    const output={status:upstream.status,body:payload,...(retryKey?{idempotencyKey:retryKey}:{})};
    return success(id,{content:[{type:"text",text:JSON.stringify(output)}],isError:!upstream.ok});
  }catch{
    return success(id,{content:[{type:"text",text:JSON.stringify({error:"folio_unavailable",...(retryKey?{idempotencyKey:retryKey}:{})})}],isError:true});
  }
}
export async function GET(){return new Response(null,{status:405,headers:{...headers,Allow:"POST"}});}
export async function DELETE(){return new Response(null,{status:405,headers:{...headers,Allow:"POST"}});}
