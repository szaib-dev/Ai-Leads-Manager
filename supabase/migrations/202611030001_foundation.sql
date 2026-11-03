-- Phase 2 only: no CSV importer, call-workflow RPC, retention job, or AI executor.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.lead_status as enum ('new','no_answer','voicemail','interested','not_interested','follow_up','meeting_booked');
create type public.call_outcome as enum ('no_answer','voicemail','interested','not_interested','callback_requested','meeting_booked','other');
create type public.import_status as enum ('pending','processing','completed','failed','rolled_back');
create type public.archive_reason as enum ('not_interested','attempts_exhausted','manual');
create type public.event_kind as enum ('call_attempt','followup_scheduled','meeting_scheduled');
create type public.permission_mode as enum ('strict','balanced','autonomous');
create type public.operation_kind as enum ('lead_update','lead_bulk_status','lead_delete_matching','import_undo','lead_restore');
create type public.operation_status as enum ('planned','approved','executing','completed','failed','reverted');

create table public.lead_pages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  description text not null default '' check (length(description) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create index lead_pages_owner_created_idx on public.lead_pages(owner_id,created_at desc,id);

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  page_id uuid not null,
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  status public.import_status not null default 'pending',
  total_rows integer not null default 0 check (total_rows >= 0),
  successful_rows integer not null default 0 check (successful_rows >= 0),
  skipped_duplicates integer not null default 0 check (skipped_duplicates >= 0),
  invalid_rows integer not null default 0 check (invalid_rows >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (successful_rows::bigint + skipped_duplicates + invalid_rows <= total_rows),
  check (status <> 'completed' or successful_rows::bigint + skipped_duplicates + invalid_rows = total_rows),
  check (completed_at is null or completed_at >= created_at),
  foreign key (page_id, owner_id) references public.lead_pages(id,owner_id) on delete restrict,
  unique (id, page_id, owner_id)
);
create index imports_owner_page_created_idx on public.imports(owner_id,page_id,created_at desc,id);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  page_id uuid not null,
  import_id uuid,
  -- Random analytics subject: never derived from names, phones, URLs or addresses.
  subject_id uuid not null default gen_random_uuid() unique,
  business_name text not null check (length(btrim(business_name)) between 1 and 300),
  phone text check (length(phone) <= 80),
  website_url text check (website_url is null or (website_url ~* '^https?://' and octet_length(website_url) <= 4096)),
  -- Original exact URL. No URL normalization, lowercasing, parameter removal or redirects.
  google_maps_url text collate "C" check (google_maps_url is null or (google_maps_url ~* '^https?://' and octet_length(google_maps_url) <= 2048)),
  country text check (length(country) <= 100),
  location text check (length(location) <= 300),
  status public.lead_status not null default 'new',
  notes text not null default '' check (octet_length(notes) <= 16000),
  extra_fields jsonb not null default '{}' check (jsonb_typeof(extra_fields) = 'object' and octet_length(extra_fields::text) <= 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_contacted_at timestamptz,
  archived_at timestamptz,
  archive_reason public.archive_reason,
  rejected_at timestamptz,
  purge_after timestamptz,
  deleted_at timestamptz,
  foreign key (page_id,owner_id) references public.lead_pages(id,owner_id) on delete restrict,
  foreign key (import_id,page_id,owner_id) references public.imports(id,page_id,owner_id) on delete restrict,
  unique (id,owner_id),
  check ((archived_at is null) = (archive_reason is null)),
  check ((rejected_at is null) = (purge_after is null)),
  check (purge_after is null or purge_after >= rejected_at + interval '480 hours')
);
-- The ONLY lead identity uniqueness rule, global across this owner's pages, including archive/soft deletes.
-- 2048-byte limit keeps raw URLs safely within PostgreSQL's btree tuple size.
create unique index leads_owner_maps_url_unique on public.leads(owner_id,google_maps_url) where google_maps_url is not null;
create index leads_page_active_created_idx on public.leads(owner_id,page_id,created_at desc,id) where archived_at is null and deleted_at is null;
create index leads_status_created_idx on public.leads(owner_id,status,created_at desc,id) where deleted_at is null;
create index leads_import_idx on public.leads(owner_id,import_id,id) where import_id is not null;
create index leads_archive_idx on public.leads(owner_id,archived_at desc,id) where archived_at is not null;
create index leads_rejected_purge_idx on public.leads(purge_after,id) where archive_reason = 'not_interested' and purge_after is not null;

create table public.call_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lead_id uuid not null,
  request_id uuid not null default gen_random_uuid(),
  outcome public.call_outcome not null,
  notes text not null default '' check (octet_length(notes) <= 16000),
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (lead_id,owner_id) references public.leads(id,owner_id) on delete cascade,
  unique (id,owner_id),
  unique (owner_id,request_id)
);
create index call_attempts_owner_lead_time_idx on public.call_attempts(owner_id,lead_id,occurred_at desc,id);

create table public.followups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lead_id uuid not null,
  scheduled_date date not null,
  scheduled_time time without time zone,
  kind text not null default 'callback' check (kind in ('callback','meeting')),
  notes text not null default '' check (octet_length(notes) <= 16000),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (lead_id,owner_id) references public.leads(id,owner_id) on delete cascade,
  unique (id,owner_id)
);
create index followups_pending_schedule_idx on public.followups(owner_id,scheduled_date,scheduled_time,id) where completed_at is null;
create index followups_lead_idx on public.followups(owner_id,lead_id);
create index followups_completed_idx on public.followups(owner_id,completed_at desc,id) where completed_at is not null;

-- An append-only, PII-free fact ledger. No business/phone/notes/snapshot payloads here.
-- Source IDs survive detail deletion and keep each attempt/scheduling event idempotent.
create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null,
  lead_id uuid,
  attempt_id uuid,
  kind public.event_kind not null,
  source_id uuid not null,
  outcome public.call_outcome,
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (lead_id,owner_id) references public.leads(id,owner_id) on delete set null (lead_id),
  foreign key (attempt_id,owner_id) references public.call_attempts(id,owner_id) on delete set null (attempt_id),
  unique (owner_id,kind,source_id),
  check ((kind = 'call_attempt') = (outcome is not null))
);
create index activity_owner_time_idx on public.activity_events(owner_id,occurred_at desc,id);
create index activity_owner_lead_idx on public.activity_events(owner_id,lead_id) where lead_id is not null;
create index activity_owner_attempt_idx on public.activity_events(owner_id,attempt_id) where attempt_id is not null;

create table private.suppression_keys (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  secret bytea not null default extensions.gen_random_bytes(32)
);
-- Permanent within an account. HMACs only; no raw contact details or lead FK to cascade away.
create table public.outreach_suppressions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  identifier_kind text not null check (identifier_kind in ('phone','maps_url')),
  fingerprint bytea not null check (octet_length(fingerprint) = 32),
  reason text not null default 'not_interested' check (reason = 'not_interested'),
  created_at timestamptz not null default now(),
  primary key (owner_id,identifier_kind,fingerprint)
);

create table public.workspace_preferences (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  ai_permission_mode public.permission_mode not null default 'strict',
  updated_at timestamptz not null default now()
);
create table public.operations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  request_id uuid not null default gen_random_uuid(),
  source text not null check (source in ('user','ai')),
  kind public.operation_kind not null,
  status public.operation_status not null default 'planned',
  permission_mode public.permission_mode not null default 'strict',
  target_page_id uuid,
  target_import_id uuid,
  affected_count integer not null default 0 check (affected_count >= 0),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  undo_expires_at timestamptz not null default (now() + interval '168 hours'),
  reverses_operation_id uuid,
  unique (id,owner_id),
  unique (owner_id,request_id),
  check (target_import_id is null or target_page_id is not null),
  check (reverses_operation_id is null or reverses_operation_id <> id),
  foreign key (target_page_id,owner_id) references public.lead_pages(id,owner_id) on delete set null (target_page_id),
  foreign key (target_import_id,target_page_id,owner_id) references public.imports(id,page_id,owner_id) on delete restrict,
  foreign key (reverses_operation_id,owner_id) references public.operations(id,owner_id) on delete restrict
);
create index operations_owner_created_idx on public.operations(owner_id,created_at desc,id);
-- Future controlled operations use soft deletes. Physical deletion deliberately destroys undo PII.
create table public.operation_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  operation_id uuid not null,
  lead_id uuid not null,
  before_data jsonb not null check (jsonb_typeof(before_data)='object' and octet_length(before_data::text)<=16384),
  after_data jsonb not null check (jsonb_typeof(after_data)='object' and octet_length(after_data::text)<=16384),
  created_at timestamptz not null default now(),
  foreign key (operation_id,owner_id) references public.operations(id,owner_id) on delete cascade,
  foreign key (lead_id,owner_id) references public.leads(id,owner_id) on delete cascade,
  unique (operation_id,lead_id)
);
create index operation_items_lead_idx on public.operation_items(owner_id,lead_id);

-- RLS is applied to EVERY public application table, even tables with no write grants.
do $$
declare t text;
begin
  foreach t in array array['lead_pages','imports','leads','call_attempts','followups','activity_events','outreach_suppressions','workspace_preferences','operations','operation_items'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy owner_select on public.%I for select to authenticated using (owner_id = (select auth.uid()))',t);
  end loop;
end $$;
-- Ordinary record editing may be used by future server services with the user's session.
-- Server/database identity, provenance, archive fields and timestamps are NOT client-writable.
grant insert (name,description) on public.lead_pages to authenticated;
grant update (name,description) on public.lead_pages to authenticated;
grant insert (page_id,business_name,phone,website_url,google_maps_url,country,location,notes,extra_fields) on public.leads to authenticated;
grant update (business_name,phone,website_url,country,location,status,notes,extra_fields) on public.leads to authenticated;
grant insert (lead_id,request_id,outcome,notes) on public.call_attempts to authenticated;
grant insert (lead_id,scheduled_date,scheduled_time,kind,notes) on public.followups to authenticated;
grant update (scheduled_date,scheduled_time,notes) on public.followups to authenticated;
do $$
declare t text;
begin
  foreach t in array array['lead_pages','leads','call_attempts','followups'] loop
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))',t);
  end loop;
  foreach t in array array['lead_pages','leads','followups'] loop
    execute format('create policy owner_update on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',t);
  end loop;
end $$;
revoke all on private.suppression_keys from public,anon,authenticated;
-- No authenticated DELETE grants. No import/audit/event/suppression writes or calling RPC yet.
