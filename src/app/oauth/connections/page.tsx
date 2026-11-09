import {createClient} from "@/lib/supabase/server";
import {redirect} from "next/navigation";
import {z} from "zod";
export const dynamic="force-dynamic";
export default async function Connections(){
  const client=await createClient();const {data:{user}}=await client.auth.getUser();if(!user)redirect("/login?next=/oauth/connections");
  const {data}=await client.rpc("integration_state" as never);
  const keys=(data as unknown as {keys?:{id:string;name:string;scopes:string[];revoked_at:string|null}[]})?.keys||[];
  async function revoke(form:FormData){"use server";const id=z.uuid().parse(form.get("id"));const c=await createClient();const {error}=await c.rpc("integration_manage_key" as never,{p_id:id,p_name:null,p_scopes:[],p_enabled:false,p_revoke:true,p_hash:null,p_prefix:null,p_expires:null} as never);if(error)throw new Error("Revocation failed");redirect("/oauth/connections");}
  return <main><h1>OAuth connections</h1>{keys.filter(k=>k.name.startsWith("OAuth: ")).map(k=><section key={k.id}><h2>{k.name}</h2><p>{k.scopes.join(", ")}</p>{k.revoked_at?<p>Revoked</p>:<form action={revoke}><input type="hidden" name="id" value={k.id}/><button>Revoke access</button></form>}</section>)}</main>;
}
