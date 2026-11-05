# WhatsApp production database repair — 2026-11-05

## Root cause and target

The Vercel code was deployed while database migrations 202611050019 and 202611050020 remained unapplied following the earlier CLI permission denial. Remote migration history ended at 202611050018. Live REST requests returned 22P02 for the missing whatsapp enum workflow value, 42703 for the missing whatsapp_status column, and PGRST202 for the absent RPC. This was a missing migration deployment, not merely stale PostgREST metadata.

After project access was restored, remote SQL confirmed the missing enum value and RPC. The CLI target and .env/.env.local point to lypfxcohmsosedwptebu. Actual requests from two authenticated browsers on https://ai-leads-manager-burak.vercel.app confirmed the deployed client uses that same Supabase hostname. Authenticated Vercel server actions successfully updated fixture rows in that database, confirming the server target too.

## Repair applied remotely

- Applied enum migration 019 and conversation migration 020, in order and separate transactions.
- Made migration 020 rerunnable: ADD COLUMN/CREATE INDEX IF NOT EXISTS and CREATE OR REPLACE FUNCTION.
- Kept WhatsApp as the lead workflow enum value; the four conversation states remain a separate constrained text column. Conversation notes and last-interaction date are separate from phone attempt records.
- Confirmed RPC signature: manage_whatsapp(p_id uuid, p_expected timestamptz, p_status text, p_notes text, p_date date). Application now uses explicit matching database types instead of never casts.
- NOTIFY pgrst, 'reload schema' refreshes metadata after commit. Anonymous execution is denied; authenticated access uses existing ownership/concurrency checks and history snapshots.
- Replayed migration 020 successfully against production to verify idempotency.
- Existing workspace_sync publication includes INSERT and UPDATE; RLS is enabled with owner_select restricted to auth.uid().

## Verification

Real production database and deployed Vercel app, disposable confirmed QA account only:

- Two independent authenticated Chromium browser contexts; second viewport 390x844.
- Call outcome Continue on WhatsApp routed a lead into Conversations and appeared in the other browser without refresh.
- Waiting for Reply, In Conversation, Interested, Closed, notes and manual interaction date persisted and synchronized.
- Followup scheduling, return to WhatsApp, archive, restore and soft deletion synchronized without refresh.
- Stale expected timestamps rejected without overwriting data.
- Disconnect/reconnect caught up on missed updates.
- Forced a Vercel mutation POST to fail: the conversation form rolled back its status and the remote database retained its previous value.
- Every WhatsApp action left the QA account's phone-call attempts at zero.
- First successful run: handoff to second browser 4,011ms; conversation state updates 3,958–4,970ms. These are end-to-end observations including Vercel/database/network/query refresh, not pure websocket latency. Repeated browser run: handoff 4,570ms; state updates 2,940–4,481ms; all checks passed including forced network-failure rollback. Before repair, those operations failed, so there is no successful before-repair baseline.
- Broader live SDK realtime regression passed imports, calls, status, followup scheduling/rescheduling/completion, archive/removal, token refresh, reconnect, duplicate prevention and cross-owner isolation.
- All disposable accounts and their fixtures removed. Original counts before migrations and after the first complete browser run plus idempotency replay: 47 leads, 6 attempts, 13 workflow history entries.
- Lint, TypeScript, 61 unit tests and production build passed on Node 24.22.1.

Reproduce the deployed browser test with Node >=22: node --env-file=.env.local tests/whatsapp-remote.mjs. It requires Supabase CLI access to retrieve administrative test credentials into memory and removes only its own temporary account. Credentials and business data are not written into reports.
