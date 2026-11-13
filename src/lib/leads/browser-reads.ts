"use client";
import { createClient } from "@/lib/supabase/browser";
import { fromDb, type ActionResult, type PageWithCounts } from "./contracts";
import type { CountryStructure } from "./country-actions";
import type { Database } from "@/types/database";
type Functions=Database["public"]["Functions"];
export async function readRpc<T>(name: keyof Functions | "country_structure", args: Record<string, unknown> = {}, signal?: AbortSignal):Promise<ActionResult<T>> {
 try { const request=createClient().rpc(name as keyof Functions,args as never);const r=await (signal?request.abortSignal(signal):request);if(r.error)return {error:r.error.message};return {data:r.data as unknown as T}; }
 catch { return {error:"Could not load workspace data. Please retry."}; }
}
export function fetchCountries(signal?:AbortSignal){return readRpc<CountryStructure>("country_structure",{},signal);}
export async function fetchWorkspaceState(){
 const r=await readRpc<{revision:number;pages:{id:string;name:string;description:string;created_at:string;lead_count:number;new_count:number;contacted_count:number;followup_count:number}[]}>("workspace_state");
 if(!r.data)return {error:r.error};
 const pages:PageWithCounts[]=r.data.pages.map(p=>({id:p.id,name:p.name,description:p.description,flag:p.name.slice(0,2).toUpperCase(),color:"blue",created:p.created_at.slice(0,10),createdAt:p.created_at,leadCount:Number(p.lead_count),newCount:Number(p.new_count),contactedCount:Number(p.contacted_count),followupCount:Number(p.followup_count??0)}));
 return {data:{pages,revision:Number(r.data.revision)}};
}
export async function fetchWhatsApp(page=0){
 if(!Number.isInteger(page)||page<0||page>10000)return {error:"Invalid page"};
 const r=await createClient().from("leads").select("*,lead_pages!inner(deleted_at)",{count:"exact"}).eq("status","whatsapp").is("lead_pages.deleted_at",null).is("deleted_at",null).is("archived_at",null).order("updated_at",{ascending:false}).order("id").range(page*15,page*15+14);
 if(r.error)return {error:r.error.message};return {data:{total:r.count||0,rows:r.data.map(row=>({lead:fromDb(row),status:row.whatsapp_status,notes:row.whatsapp_notes,date:row.whatsapp_last_interaction||""}))}};
}
