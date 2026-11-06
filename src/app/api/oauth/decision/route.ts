import {createClient} from "@/lib/supabase/server";
import {oauthConfig,oauthEnabled} from "@/lib/integrations/oauth";
import {scopeSchema} from "@/lib/integrations/contracts";
import {z} from "zod";
export async function POST(request:Request){
  if(!oauthEnabled())return new Response(null,{status:404});
  if(request.headers.get("Origin")!==new URL(oauthConfig().resource).origin)return new Response(null,{status:403});
  if(Number(request.headers.get("Content-Length")||0)>8192)return new Response(null,{status:413});
  const form=await request.formData();const id=z.string().regex(/^[A-Za-z0-9_-]{1,256}$/).safeParse(form.get("authorization_id"));
  const scopes=z.array(scopeSchema).max(11).safeParse(form.getAll("permissions"));
  if(!id.success||!scopes.success)return new Response(null,{status:400});
  const client=await createClient();const {data:{user}}=await client.auth.getUser();if(!user)return new Response(null,{status:401});
  const {data,error}=await client.auth.oauth.getAuthorizationDetails(id.data);
  if(error||!data||!("client" in data)||data.user.id!==user.id)return new Response(null,{status:400});
  const decision=z.enum(["approve","deny"]).safeParse(form.get("decision"));if(!decision.success)return new Response(null,{status:400});
  const approve=decision.data==="approve";
  if(approve){const grant=await client.rpc("folio_oauth_grant" as never,{p_client:data.client.id,p_name:data.client.name,p_scopes:scopes.data,p_revoke:false} as never);if(grant.error)return new Response(null,{status:503});}
  const result=approve?await client.auth.oauth.approveAuthorization(id.data,{skipBrowserRedirect:true}):await client.auth.oauth.denyAuthorization(id.data,{skipBrowserRedirect:true});
  if(result.error||!result.data)return new Response(null,{status:400});
  const target=new URL(result.data.redirect_url);
  if(target.protocol!=="https:" && !(target.protocol==="http:" && ["localhost","127.0.0.1"].includes(target.hostname)))return new Response(null,{status:400});
  return Response.redirect(result.data.redirect_url,303);
}
