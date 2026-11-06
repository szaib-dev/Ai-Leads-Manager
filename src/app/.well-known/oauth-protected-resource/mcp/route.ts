import {oauthConfig,oauthEnabled} from "@/lib/integrations/oauth";
export function GET(){
  if(!oauthEnabled())return new Response(null,{status:404});
  const {resource,issuer}=oauthConfig();
  return Response.json({resource,authorization_servers:[issuer],bearer_methods_supported:["header"],scopes_supported:["openid"]},{headers:{"Cache-Control":"no-store"}});
}
