import {getSupabaseConfig} from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
const headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"};

/**
 * RFC 9728 resource discovery for the Folio MCP endpoint.
 * Supabase Auth is the OAuth authorization server, not the Folio website.
 *
 * Never derive resource URIs or auth URLs from untrusted forwarded Host headers.
 */
export async function GET() {
  const config = getSupabaseConfig();
  if (!config) return Response.json({error: "OAuth provider is not configured"}, {status: 503, headers});
  const resource = "https://ai-leads-manager-burak.vercel.app/mcp";
  return Response.json({
    resource,
    authorization_servers: [`${config.url}/auth/v1`],
    bearer_methods_supported: ["header"],
    resource_documentation: "https://ai-leads-manager-burak.vercel.app/docs/integrations"
  }, {headers});
}
