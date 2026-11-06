import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const safeId = (value: FormDataEntryValue | null) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : null;
const headers = {"Cache-Control": "no-store"};

export async function POST(request: Request) {
  // Opt in only after RLS and OAuth-specific MCP permission enforcement are reviewed.
  if (process.env.FOLIO_OAUTH_ENABLED !== "true") {
    return NextResponse.json({error: "oauth_not_enabled"}, {status: 503, headers});
  }
  // Browser form is only accepted from Folio's own origin. OAuth codes are
  // delivered to the provider-validated redirect URI after a consent decision.
  const origin = request.headers.get("origin");
  const expected = process.env.FOLIO_PUBLIC_ORIGIN ?? "https://ai-leads-manager-burak.vercel.app";
  if (origin !== expected) return NextResponse.json({error: "invalid_origin"}, {status: 403, headers});
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 8192) return NextResponse.json({error: "request_too_large"}, {status: 413, headers});
  const body = await request.formData();
  const id = safeId(body.get("authorization_id"));
  const decision = body.get("decision");
  if (!id || (decision !== "approve" && decision !== "deny")) {
    return NextResponse.json({error: "invalid_request"}, {status: 400, headers});
  }
  const client = await createClient();
  const {data: userData, error: userError} = await client.auth.getUser();
  if (userError || !userData.user) return NextResponse.json({error: "authentication_required"}, {status: 401, headers});
  const {data: details, error: detailsError} = await client.auth.oauth.getAuthorizationDetails(id);
  if (detailsError || !details || !("authorization_id" in details)) {
    return NextResponse.json({error: "authorization_expired"}, {status: 400, headers});
  }
  const result = decision === "approve"
    ? await client.auth.oauth.approveAuthorization(id)
    : await client.auth.oauth.denyAuthorization(id);
  if (result.error || !result.data) {
    return NextResponse.json({error: "authorization_failed"}, {status: 400, headers});
  }
  const location = new URL(result.data.redirect_url);
  if (location.protocol !== "https:" && !(location.protocol === "http:" && ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return NextResponse.json({error: "unsafe_redirect"}, {status: 400, headers});
  }
  return NextResponse.redirect(location, {status: 303, headers});
}
