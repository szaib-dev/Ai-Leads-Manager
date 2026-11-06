import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = {title: "Authorize an integration | Folio"};

const panel: React.CSSProperties = {
  maxWidth: 580, margin: "8vh auto", padding: 32, borderRadius: 20,
  border: "1px solid #323843", background: "#1a1c23", color: "#f4f5f7",
  fontFamily: "system-ui, sans-serif", boxShadow: "0 20px 70px #0003"
};
const safeId = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : null;

export default async function OAuthConsent({searchParams}: {
  searchParams: Promise<{authorization_id?: string}>
}) {
  const authorizationId = safeId((await searchParams).authorization_id);
  if (!authorizationId) return <main style={panel}><h1>Invalid authorization request</h1><p>Missing or invalid authorization ID.</p></main>;

  // Feature flag: exposing the OAuth consent screen alone must NEVER enable
  // unrestricted third-party access to Folio's existing Supabase RLS tables.
  if (process.env.FOLIO_OAUTH_ENABLED !== "true") {
    return <main style={panel}><h1>OAuth is not enabled yet</h1><p>This integration is being prepared. No account access has been granted.</p></main>;
  }
  const client = await createClient();
  const {data: userData, error: userError} = await client.auth.getUser();
  if (userError || !userData.user) {
    redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`);
  }
  const {data: details, error} = await client.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !details) {
    return <main style={panel}><h1>Authorization unavailable</h1><p>That authorization request may have expired. Restart the connection in ChatGPT.</p></main>;
  }
  if (!("authorization_id" in details)) {
    redirect(details.redirect_url);
  }

  const scope = details.scope?.trim() || "email";
  return (
    <main style={panel}>
      <p style={{fontSize: 13, letterSpacing: 2, color: "#b4a5ff", fontWeight: 700}}>FOLIO / CONNECT</p>
      <h1 style={{fontSize: 30, marginBottom: 10}}>Authorize {details.client.name}?</h1>
      <p style={{lineHeight: 1.6, color: "#c6c9d3"}}>
        This application is requesting permission to connect to your Folio account.
        Only approve applications that you trust.
      </p>
      <dl style={{lineHeight: 1.9, overflowWrap: "anywhere"}}>
        <dt style={{fontWeight: 700}}>Requesting application</dt>
        <dd style={{marginLeft: 0}}>{details.client.name}</dd>
        <dt style={{fontWeight: 700}}>Redirect address</dt>
        <dd style={{marginLeft: 0}}>{details.redirect_uri}</dd>
        <dt style={{fontWeight: 700}}>Identity scopes</dt>
        <dd style={{marginLeft: 0}}>{scope.split(" ").join(", ")}</dd>
      </dl>
      <p style={{fontSize: 13, lineHeight: 1.6, color: "#ffcf9f"}}>
        OAuth identity scopes do not limit database privileges. Access must also be
        restricted by Folio integration permissions and database policies.
      </p>
      <form method="post" action="/api/oauth/decision" style={{display: "flex", flexWrap: "wrap", gap: 12, marginTop: 28}}>
        <input type="hidden" name="authorization_id" value={authorizationId}/>
        <button name="decision" value="deny" style={{padding: "12px 22px", borderRadius: 10, border: "1px solid #555", background: "#292d35", color: "white", cursor: "pointer"}}>Deny</button>
        <button name="decision" value="approve" style={{padding: "12px 22px", borderRadius: 10, border: 0, background: "#9b87ff", color: "#12121a", fontWeight: 700, cursor: "pointer"}}>Authorize</button>
      </form>
    </main>
  );
}
