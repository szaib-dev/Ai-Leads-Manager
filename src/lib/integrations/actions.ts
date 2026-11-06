"use server";
import {randomBytes,createHash} from "node:crypto";
import {z} from "zod";
import {databaseContext} from "@/lib/db/context";
import {keySchema,scopeSchema,type IntegrationState} from "./contracts";
import type {ActionResult} from "@/lib/leads/contracts";
async function rpc(name:string,args:Record<string,unknown>={}){const {client}=await databaseContext();const r=await client.rpc(name as never,args as never);if(r.error)throw new Error("Could not update integrations. Check database setup and retry.");return r.data;}
function failure(e:unknown){if(e&&typeof e==="object"&&"digest" in e)throw e;return {error:e instanceof z.ZodError?"Check the supplied fields.":e instanceof Error?e.message:"Request failed"};}
export async function integrationState():Promise<ActionResult<IntegrationState>>{try{return {data:await rpc("integration_state") as unknown as IntegrationState};}catch(e){return failure(e);}}
export async function generateApiKey(input:unknown):Promise<ActionResult<{secret:string}>>{try{const p=keySchema.parse(input),secret="folio_"+randomBytes(32).toString("hex");await rpc("integration_manage_key",{p_id:null,p_name:p.name,p_scopes:p.scopes,p_enabled:true,p_revoke:false,p_hash:createHash("sha256").update(secret).digest("hex"),p_prefix:secret.slice(0,14),p_expires:new Date(Date.now()+p.days*86400000).toISOString()});return {data:{secret}};}catch(e){return failure(e);}}
export async function updateApiKey(input:unknown):Promise<ActionResult<true>>{try{const p=z.object({id:z.uuid(),scopes:z.array(scopeSchema).max(11),enabled:z.boolean(),revoke:z.boolean().default(false)}).strict().parse(input);await rpc("integration_manage_key",{p_id:p.id,p_name:null,p_scopes:p.scopes,p_enabled:p.enabled,p_revoke:p.revoke,p_hash:null,p_prefix:null,p_expires:null});return {data:true};}catch(e){return failure(e);}}
export async function toggleIntegrations(enabled:boolean):Promise<ActionResult<true>>{try{await rpc("integration_toggle",{p_enabled:z.boolean().parse(enabled)});return {data:true};}catch(e){return failure(e);}}
