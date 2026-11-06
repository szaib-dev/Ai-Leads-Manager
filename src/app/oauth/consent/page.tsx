import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {oauthEnabled} from "@/lib/integrations/oauth";
import {permissions} from "@/lib/integrations/contracts";
export const dynamic="force-dynamic";
export default async function Consent({searchParams}:{searchParams:Promise<{authorization_id?:string}>}) {
  if(!oauthEnabled())return <main>OAuth connections are disabled.</main>;
  const {authorization_id:id}=await searchParams;
  if(!id || !/^[A-Za-z0-9_-]{1,256}$/.test(id))return <main>Invalid authorization request.</main>;
  const client=await createClient();const {data:{user}}=await client.auth.getUser();
  if(!user)redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${id}`)}`);
  const {data,error}=await client.auth.oauth.getAuthorizationDetails(id);
  if(error||!data)return <main>Authorization request unavailable.</main>;
  if(!("client" in data))return <main>This authorization has already been decided. Start a new connection to change Folio permissions.</main>;
  return <main style={{maxWidth:640,margin:"48px auto",padding:24}}><h1>Connect to Folio</h1><p>Client: {data.client.name}</p><p>Client ID: {data.client.id}</p><p>Registered website: {data.client.uri}</p><p>Redirect URI: {data.redirect_uri}</p><p>Identity scopes requested: {data.scope}</p><p>Select the Folio permissions you authorize for this client. Access expires after 90 days. Revoke access in OAuth connections.</p><form action="/api/oauth/decision" method="post"><input type="hidden" name="authorization_id" value={id}/>{Object.entries(permissions).map(([scope,label])=><label key={scope} style={{display:"block",margin:12}}><input type="checkbox" name="permissions" value={scope}/>{label}</label>)}<button name="decision" value="approve">Allow selected permissions</button> <button name="decision" value="deny">Deny</button></form><a href="/oauth/connections">OAuth connections</a></main>;
}
