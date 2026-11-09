import {createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey} from "jose";
import {z} from "zod";

export function oauthConfig() {
  const resource = process.env.FOLIO_OAUTH_RESOURCE;
  const project = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!resource || !project) throw new Error("OAuth unavailable");
  const url = new URL(resource);
  const localHttp = url.protocol === "http:" && ["localhost","127.0.0.1"].includes(url.hostname);
  if ((!localHttp && url.protocol !== "https:") || url.pathname !== "/mcp" || url.search || url.hash || url.username || url.password) throw new Error("Invalid OAuth resource");
  return {resource, issuer: `${new URL(project).origin}/auth/v1`};
}
const resolvers = new Map<string, JWTVerifyGetKey>();
export async function verifyOAuth(token: string, config: {issuer:string;resource:string}, key?: JWTVerifyGetKey) {
  if (token.length > 16384) throw new Error("Invalid token");
  let resolver = key || resolvers.get(config.issuer);
  if (!resolver) {
    resolver = createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`));
    resolvers.set(config.issuer, resolver);
  }
  const {payload} = await jwtVerify(token, resolver, {algorithms:["ES256"], issuer:config.issuer, audience:config.resource, requiredClaims:["exp","iat","sub","client_id"], clockTolerance:0});
  z.object({sub:z.uuid(),client_id:z.uuid(),role:z.literal("folio_oauth"),folio_purpose:z.literal("mcp_access"),iat:z.number().max(Math.floor(Date.now()/1000)),exp:z.number()}).parse(payload);
  return payload;
}
export function oauthEnabled() { return process.env.FOLIO_OAUTH_ENABLED === "true"; }
