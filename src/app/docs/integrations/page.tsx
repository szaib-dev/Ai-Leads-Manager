import Link from "next/link";
import {Waves,ArrowUpRight,Webhook,ShieldCheck} from "lucide-react";
import {documentedActions} from "@/lib/integrations/documentation";
import {ActionReference,CodeBlock} from "./reference";
import styles from "./page.module.css";
export const metadata={title:"Integration documentation",description:"Public Folio API and webhook-style integration guide: lead creation, edits, imports, deletion, meetings, follow-ups, permissions and retries."};
const endpoint="https://ai-leads-manager-burak.vercel.app/api/v1/requests";
const curl=`curl '${endpoint}' \
  -X POST \
  -H 'Authorization: Bearer YOUR_SECRET' \
  -H 'Content-Type: application/json' \
  --data '{"action":"leads.search","data":{"query":"Cedar Dental","limit":20}}'`;
const retryExample=`// Server-side JavaScript. Keep secrets in your connector's credential store.
const requestId = crypto.randomUUID(); // One new UUID per intended write.
const body = JSON.stringify({
  action: "meetings.create",
  data: {
    leadId: "REPLACE_WITH_LEAD_UUID",
    expectedUpdatedAt: "COPY_THE_FULL_UPDATED_AT_FROM_A_FRESH_READ",
    startsAt: "2030-07-01T15:00:00+05:00", // Replace with a future meeting time.
    timezone: "Asia/Karachi",
    notes: "Discuss the website project"
  }
});
const response = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "Authorization": "Bearer " + process.env.FOLIO_API_KEY,
    "Content-Type": "application/json",
    "Idempotency-Key": requestId
  },
  body
});
const result = await response.json();
// If the network fails, retry the SAME body and requestId.
// For a new operation, generate a NEW requestId and read the lead again.`;
const errors=[
 ["400","invalid_idempotency_key / idempotency_key_required","Supply a valid UUID retry header for writes."],
 ["401","invalid_api_key","Check the bearer secret. Revoked or expired keys cannot be reused."],
 ["403","api_disabled / permission_disabled","Enable the master switch/key and the permission for this action in Settings."],
 ["404","lead_not_found / meeting_not_found","Verify IDs belong to this workspace and records are still available."],
 ["409","stale_lead","Read the lead again, review the change, then submit a new operation with the fresh revision."],
 ["409","idempotency_conflict","That UUID belongs to a different payload/action. Do not reuse it for a new write."],
 ["409","pending_schedule_exists / use_meetings_endpoint","Review the existing schedule. Reschedule or cancel the meeting using its own permission."],
 ["413 / 415","payload_too_large / json_required","Keep the body within 32 KB and set Content-Type: application/json."],
 ["422","invalid_request_fields / request_rejected","Check field names, status, future timestamp, URL/date limits and existing workflow restrictions."],
 ["429","rate_limited","Wait at least 60 seconds (Retry-After). Preserve the same retry key/body for an uncertain write."],
 ["503","integration_unavailable","Retry later. If a write's outcome is unknown, keep its original retry UUID and body."],
];
export default function IntegrationDocs(){return <div className={styles.site}>
 <header className={styles.header}><Link href="/docs/integrations" className={styles.brand}><Waves size={25}/>folio<span>Developers</span></Link><nav aria-label="Documentation links"><a href="/api/v1/openapi.json">OpenAPI</a><Link href="/dash/settings/integrations">Open dashboard<ArrowUpRight size={14}/></Link></nav></header>
 <div className={styles.layout}><aside className={styles.sidebar}><nav aria-label="On this page"><strong>Integration guide</strong>{[["start","Quick start"],["webhooks","Webhooks vs API"],["authentication","Keys & permissions"],["workflow","Safe write workflow"],["reference","All actions"],["scheduling","Scheduling & timezones"],["responses","Responses & errors"],["automation","Connect an assistant"]].map(([id,title])=><a href={`#${id}`} key={id}>{title}</a>)}<details><summary>Action index ({documentedActions.length})</summary>{documentedActions.map(a=><a key={a.request.action} href={`#${a.request.action}`}>{a.request.action}</a>)}</details></nav></aside>
 <main className={styles.main}><div className={styles.hero}><span className={styles.eyebrow}><Webhook size={16}/> INTEGRATIONS / API v1</span><h1>Your workflows.<br/>Connected to Folio.</h1><p>Send leads, update your pipeline, and schedule conversations from an assistant or automation. Every supported request is documented here.</p><div className={styles.chips}><span>Public documentation</span><span>{documentedActions.length} actions</span><span>Scoped API keys</span></div></div>
 <section id="webhooks" className={styles.section}><h2>Webhook-style requests, with clear boundaries</h2><div className={styles.callout}><strong>Incoming commands are supported. Outgoing event webhooks are not yet supported.</strong><p>Configure your automation to send an HTTP POST to Folio. The action in its JSON body selects what happens. These are authenticated API commands; there is no separate URL for each action.</p><p>Folio currently cannot register callback URLs or push lead-change events to your system. Do not configure an outgoing webhook subscription or expect event deliveries. Dashboard realtime synchronization is separate.</p></div></section>
 <section id="start" className={styles.section}><h2>Quick start</h2><ol><li>Sign in and open <Link href="/dash/settings/integrations">Settings → Manage integrations</Link>.</li><li>Generate a secret key. Enable only the permissions your integration needs; new keys start with read access.</li><li>Save the secret in your tool’s secure credentials. Folio shows it once; it cannot be retrieved later.</li><li>Use a server-side HTTP request with the endpoint and headers below. Start with a read before sending any changes.</li></ol><p className={styles.endpoint}><strong>POST</strong><code>{endpoint}</code></p><CodeBlock text={curl}/><p>Replace YOUR_SECRET with your generated key. Example business names, UUIDs and timestamps are fictional; replace them with your own records. Do not paste real secrets into shared documents or public code.</p></section>
 <section id="authentication" className={styles.section}><h2><ShieldCheck size={21}/> Keys, permissions & controls</h2><p>Send <code>Authorization: Bearer YOUR_SECRET</code> and <code>Content-Type: application/json</code>. Every request is limited to the key owner’s workspace. No owner ID, Supabase key, or dashboard cookie is needed.</p><p>Settings lets you enable/disable each permission, pause a key, pause all external requests, or permanently revoke a key. Expiry is automatic. Permission and pause/revoke checks also apply to retries.</p><ul><li>Generate a replacement before revoking an old key when rotating credentials.</li><li>A paused key can be enabled again. A revoked or expired secret cannot be used for requests.</li><li>The API limit is 60 identified requests per minute per key. The maximum body is 32 KB.</li><li>Recent requests lists identified actions, statuses and retry IDs; request bodies and secrets are excluded. Malformed requests rejected before key verification may not appear there.</li></ul></section>
 <section id="workflow" className={styles.section}><h2>Read → confirm → write → verify</h2><ol><li><code>pages.list</code> finds page IDs. <code>leads.search</code> finds the lead; confirm the correct business when names are similar.</li><li>Read <code>leads.get</code> and copy its full <code>updated_at</code> string into <code>expectedUpdatedAt</code>. Do not round or reformat it.</li><li>For a write, send a new UUID in <code>Idempotency-Key</code>. Keep the UUID and exact body together.</li><li>For a network failure, retry the identical action/body with the same UUID. Never generate a new UUID merely because the response was lost.</li><li>For a stale revision (409), read and review the latest lead, then create a new intended operation. For the next action, use the latest IDs/revision.</li></ol><p>The business name is not an ID. Page IDs, lead IDs and meeting IDs identify different records. In particular, a create/import receipt’s <code>id</code> is an import batch ID—not the newly created lead.</p><CodeBlock text={retryExample}/></section>
 <section id="reference" className={styles.section}><h2>Every supported action</h2><p>All examples below are JSON bodies sent to the same POST endpoint. The permission shown must be enabled on your key. Every write also needs an Idempotency-Key header.</p><ActionReference/></section>
 <section id="scheduling" className={styles.section}><h2>Scheduling & timezones</h2><p>Use a future ISO 8601 instant with an explicit UTC offset (or Z), plus an IANA timezone such as <code>Asia/Karachi</code> or <code>America/New_York</code>. Resolve phrases such as “tomorrow at 3” to a specific date and timezone before sending.</p><p>Folio stores its existing schedule date/time fields in Pakistan time. The source timezone and UTC instant are retained in notes. For example, <code>2030-07-01T10:00:00-04:00</code> is <strong>7:00 PM Pakistan time</strong>. Keep the offset consistent with the intended timezone and date, including daylight saving time.</p><p>A lead can have an existing pending schedule. Create requests do not silently replace it; inspect meetings, then reschedule or cancel as appropriate. Rescheduling may return a new meeting ID. Do not change a lead directly to <code>meeting_booked</code> or <code>follow_up</code> through leads.update.</p><div className={styles.callout}>Scheduling updates Folio only. It does not send calendar invitations, emails, WhatsApp messages, or record phone-call attempts.</div></section>
 <section id="responses" className={styles.section}><h2>Responses & recovery</h2><CodeBlock text={JSON.stringify({data:{id:"RECORD_ID",updated_at:"EXACT_SERVER_REVISION"},requestId:"YOUR_REQUEST_UUID"},null,2)}/><p>The contents of <code>data</code> depend on the action. Errors return <code>{'{"error":{"code":"permission_disabled"},"requestId":"…"}'}</code>. Check the HTTP status and error code; HTTP 200 indicates a successful operation, not that every row in an import was accepted. Inspect imported/duplicate counts.</p><div className={styles.tableWrap}><table><thead><tr><th>Status</th><th>Code</th><th>What to do</th></tr></thead><tbody>{errors.map(([status,code,help])=><tr key={code}><td>{status}</td><td><code>{code}</code></td><td>{help}</td></tr>)}</tbody></table></div></section>
 <section id="automation" className={styles.section}><h2>Connect an assistant or automation</h2><ol><li>Use an API-capable tool/connector; skill instructions alone cannot make network calls.</li><li>Import the <a href="/api/v1/openapi.json">OpenAPI specification</a> where your tool supports it, or configure a POST HTTP-request step manually.</li><li>Store your bearer secret as a credential, map the action and data fields, and retain the request UUID across retries.</li><li>Tell the assistant to search first, confirm ambiguous leads and destructive actions, and never invent IDs, revisions or successful results.</li><li>Verify changes in Folio. Its mounted dashboard views synchronize through realtime; this does not deliver an outgoing webhook to your automation.</li></ol><p>Country creation/moving, WhatsApp messages, phone-call logging, and editing/cancelling non-meeting follow-ups are not exposed by these integration actions. Use the dashboard for those workflows.</p></section>
 <footer className={styles.footer}>Folio Integration API v1 · No sign-in required to read this guide.<Link href="/dash/settings/integrations">Manage your integration →</Link></footer>
 </main></div></div>;}
