-- Phase 4: confirmed workflows, compensating corrections and durable, PII-free events.
alter table public.call_attempts add column voided_at timestamptz;
alter table public.activity_events add column voided_at timestamptz;
alter table public.activity_events add column change_id uuid;
alter table public.activity_events add column from_status public.lead_status;
alter table public.activity_events add column to_status public.lead_status;
alter table public.activity_events drop constraint activity_events_check;
alter table public.activity_events alter column kind type text using kind::text;
alter table public.activity_events add check ((kind='call_attempt')=(outcome is not null));
alter table public.activity_events add constraint activity_kind_valid check(kind in ('call_attempt','followup_scheduled','meeting_scheduled','followup_updated','followup_completed','followup_cancelled','status_changed','archived','restored','change_reverted','lead_deleted','lead_purged'));
alter table public.leads add column rejection_source uuid;
alter table public.followups add column cancelled_at timestamptz;
alter table public.followups add column completion_outcome public.call_outcome;
alter table public.followups add column created_by_change uuid;
alter table public.followups add column auto_from_import uuid;
-- Preserve any legacy scheduling details, but expose at most one pending task per lead.
with ranked as (select id,row_number() over(partition by owner_id,lead_id order by created_at desc,id desc) n from public.followups where completed_at is null)
update public.followups set cancelled_at=clock_timestamp() where id in(select id from ranked where n>1);
create unique index followups_one_pending on public.followups(owner_id,lead_id) where completed_at is null and cancelled_at is null;
create index activity_change_idx on public.activity_events(owner_id,change_id) where change_id is not null;

create table public.workflow_changes (
 id uuid primary key default gen_random_uuid(),
 sequence bigint generated always as identity,
 owner_id uuid not null references auth.users(id) on delete cascade,
 lead_id uuid not null,
 request_id uuid not null,
 kind text not null check(kind in ('attempt','lead_edit','archive','restore','delete','followup')),
 attempt_id uuid,
 before_data jsonb not null,
 before_followups jsonb not null default '[]',
 after_followups jsonb not null default '[]',
 after_updated_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 undone_at timestamptz,
 foreign key(lead_id,owner_id) references public.leads(id,owner_id) on delete cascade,
 foreign key(attempt_id,owner_id) references public.call_attempts(id,owner_id) on delete set null(attempt_id),
 unique(owner_id,request_id)
);
create index workflow_lead_recent_idx on public.workflow_changes(owner_id,lead_id,sequence desc);
alter table public.workflow_changes enable row level security;
revoke all on public.workflow_changes from public,anon,authenticated;
grant select on public.workflow_changes to authenticated;
create policy owner_select on public.workflow_changes for select to authenticated using(owner_id=(select auth.uid()));

-- Each rejection has its own opaque suppression source. Explicit correction can remove
-- that source without releasing the same phone rejected independently on another lead.
create table private.suppression_sources (
 owner_id uuid not null references auth.users(id) on delete cascade,
 identifier_kind text not null,
 fingerprint bytea not null,
 source_id uuid not null,
 primary key(owner_id,identifier_kind,fingerprint,source_id)
);
revoke all on private.suppression_sources from public,anon,authenticated;
insert into private.suppression_sources select owner_id,identifier_kind,fingerprint,gen_random_uuid() from public.outreach_suppressions;
create or replace function private.canonical_phone(value text) returns text language sql immutable set search_path='' as $$
 select case when regexp_replace(value,'[[:space:]().-]','','g') ~ '^\+?[0-9]{7,15}$' then regexp_replace(value,'[[:space:]().-]','','g') else null end
$$;
create or replace function private.lead_lifecycle() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.id<>old.id or new.owner_id<>old.owner_id or new.subject_id<>old.subject_id or new.created_at<>old.created_at or new.google_maps_url is distinct from old.google_maps_url or new.import_id is distinct from old.import_id) then raise exception 'Lead identity and provenance are immutable' using errcode='23514';end if;
 new.updated_at=clock_timestamp();
 if current_user=(select pg_get_userbyid(relowner) from pg_class where oid='public.leads'::regclass) and exists(select 1 from public.workflow_changes where id=nullif(current_setting('folio.undo_id',true),'')::uuid and lead_id=new.id and undone_at is null) then return new;end if;
 if new.status='not_interested' then
  if tg_op='INSERT' then new.rejected_at=clock_timestamp();new.rejection_source=gen_random_uuid();
  elsif old.status<>'not_interested' then new.rejected_at=clock_timestamp();new.rejection_source=gen_random_uuid();
  else new.rejected_at=old.rejected_at;new.rejection_source=old.rejection_source;end if;
  new.archived_at=new.rejected_at;new.archive_reason='not_interested';new.purge_after=new.rejected_at+interval '480 hours';
 elsif tg_op='UPDATE' and old.archive_reason='not_interested' then
  new.archived_at=null;new.archive_reason=null;new.rejected_at=null;new.purge_after=null;new.rejection_source=null;
 end if;
 return new;
end $$;
create or replace function private.remember_rejection() returns trigger language plpgsql security definer set search_path='' as $$
declare secret_value bytea;phone_value text;fp bytea;begin
 if new.status<>'not_interested' then return new;end if;
 insert into private.suppression_keys(owner_id) values(new.owner_id) on conflict do nothing;
 select secret into secret_value from private.suppression_keys where owner_id=new.owner_id;
 phone_value=private.canonical_phone(new.phone);
 if phone_value is not null then
  fp=extensions.hmac(convert_to(phone_value,'UTF8'),secret_value,'sha256');
  insert into public.outreach_suppressions(owner_id,identifier_kind,fingerprint) values(new.owner_id,'phone',fp) on conflict do nothing;
  insert into private.suppression_sources values(new.owner_id,'phone',fp,coalesce(new.rejection_source,new.subject_id)) on conflict do nothing;
 end if;
 if new.google_maps_url is not null then
  fp=extensions.hmac(convert_to(new.google_maps_url,'UTF8'),secret_value,'sha256');
  insert into public.outreach_suppressions(owner_id,identifier_kind,fingerprint) values(new.owner_id,'maps_url',fp) on conflict do nothing;
  insert into private.suppression_sources values(new.owner_id,'maps_url',fp,coalesce(new.rejection_source,new.subject_id)) on conflict do nothing;
 end if;return new;
end $$;

update public.leads set status=status where status='not_interested';

create function private.current_change(p_lead uuid) returns uuid language sql stable security definer set search_path='' as $$
 select id from public.workflow_changes where id=nullif(current_setting('folio.change_id',true),'')::uuid and lead_id=p_lead and owner_id=auth.uid() and after_updated_at is null and undone_at is null
$$;
create function private.lead_state(p_lead uuid) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(l) from public.leads l where id=p_lead
$$;
create function private.start_change(p_lead uuid,p_expected timestamptz,p_kind text,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();c uuid;l public.leads%rowtype;begin
 if p_request is null then raise exception 'Request ID required';end if;
 perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 select id into c from public.workflow_changes where owner_id=u and request_id=p_request;
 if found then
  if not exists(select 1 from public.workflow_changes where id=c and lead_id=p_lead and kind=p_kind) then raise exception 'Request ID was used for a different action';end if;
  return c;
 end if;
 select * into l from public.leads where id=p_lead and owner_id=u and deleted_at is null for update;
 if not found or not exists(select 1 from public.lead_pages where id=l.page_id and owner_id=u and deleted_at is null) then raise exception 'Lead unavailable' using errcode='42501';end if;
 if p_expected is null or l.updated_at<>p_expected then raise exception 'Lead changed. Reload before confirming.' using errcode='40001';end if;
 insert into public.workflow_changes(owner_id,lead_id,request_id,kind,before_data,before_followups)
 values(u,p_lead,p_request,p_kind,to_jsonb(l),coalesce((select jsonb_agg(to_jsonb(f) order by id) from public.followups f where lead_id=p_lead and owner_id=u and completed_at is null and cancelled_at is null),'[]')) returning id into c;
 perform set_config('folio.change_id',c::text,true);return c;
end $$;
create function private.finish_change(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.workflow_changes c set after_updated_at=l.updated_at,
 after_followups=coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.followups f where f.owner_id=c.owner_id and f.lead_id=c.lead_id and (f.created_by_change=c.id or f.id in(select (x->>'id')::uuid from jsonb_array_elements(c.before_followups)x))),'[]')
 from public.leads l where c.id=p_id and l.id=c.lead_id;
end $$;

create function private.workflow_lead_event() returns trigger language plpgsql security definer set search_path='' as $$
declare c uuid=private.current_change(new.id);begin
 if new.status is distinct from old.status then
  insert into public.activity_events(owner_id,subject_id,lead_id,kind,source_id,from_status,to_status,change_id) values(new.owner_id,new.subject_id,new.id,'status_changed',gen_random_uuid(),old.status,new.status,c);
 end if;
 if new.archived_at is distinct from old.archived_at then
  insert into public.activity_events(owner_id,subject_id,lead_id,kind,source_id,change_id) values(new.owner_id,new.subject_id,new.id,case when new.archived_at is null then 'restored' else 'archived' end,gen_random_uuid(),c);
 end if;
 if old.deleted_at is null and new.deleted_at is not null then
  insert into public.activity_events(owner_id,subject_id,lead_id,kind,source_id,change_id) values(new.owner_id,new.subject_id,new.id,'lead_deleted',gen_random_uuid(),c);
 end if;return new;
end $$;
create trigger workflow_lead_event after update on public.leads for each row execute function private.workflow_lead_event();

create or replace function private.record_attempt_fact() returns trigger language plpgsql security definer set search_path='' as $$
declare subject uuid;begin
 select subject_id into strict subject from public.leads where id=new.lead_id and owner_id=new.owner_id;
 insert into public.activity_events(owner_id,subject_id,lead_id,attempt_id,kind,source_id,outcome,occurred_at,change_id) values(new.owner_id,subject,new.lead_id,new.id,'call_attempt',new.id,new.outcome,new.occurred_at,private.current_change(new.lead_id));
 update public.leads set last_contacted_at=greatest(last_contacted_at,new.occurred_at) where id=new.lead_id and owner_id=new.owner_id;
 return new;
end $$;
create or replace function private.record_followup_fact() returns trigger language plpgsql security definer set search_path='' as $$
declare subject uuid;k text;begin
 if tg_op='INSERT' then k=case when new.kind='meeting' then 'meeting_scheduled' else 'followup_scheduled' end;
 elsif new.completed_at is distinct from old.completed_at and new.completed_at is not null then k='followup_completed';
 elsif new.cancelled_at is distinct from old.cancelled_at and new.cancelled_at is not null then k='followup_cancelled';
 else k='followup_updated';end if;
 select subject_id into strict subject from public.leads where id=new.lead_id and owner_id=new.owner_id;
 insert into public.activity_events(owner_id,subject_id,lead_id,kind,source_id,change_id) values(new.owner_id,subject,new.lead_id,k,case when tg_op='INSERT' then new.id else gen_random_uuid() end,private.current_change(new.lead_id));
 return new;
end $$;
drop trigger record_followup_fact on public.followups;
create trigger record_followup_fact after insert or update on public.followups for each row execute function private.record_followup_fact();
create or replace function private.immutable_attempt() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user=(select pg_get_userbyid(relowner) from pg_class where oid='public.call_attempts'::regclass) and (to_jsonb(new)-'voided_at')=(to_jsonb(old)-'voided_at') and old.voided_at is null and new.voided_at is not null then return new;end if;
 raise exception 'Call attempts are immutable; use a compensating correction' using errcode='23514';
end $$;
create or replace view public.lead_attempt_summary with(security_invoker=true) as
select a.owner_id,a.lead_id,count(*)::integer total_attempts,
 count(*) filter(where a.outcome in('no_answer','voicemail'))::integer failed_attempts,
 count(*) filter(where a.outcome in('no_answer','voicemail') and a.occurred_at>coalesce(c.last_connected_at,'-infinity'::timestamptz))::integer consecutive_failed_attempts,
 (array_agg(a.outcome order by a.occurred_at desc,a.id desc))[1] latest_outcome,max(a.occurred_at) last_attempt_at
from public.call_attempts a left join(select owner_id,lead_id,max(occurred_at) filter(where outcome not in('no_answer','voicemail')) last_connected_at from public.call_attempts where voided_at is null group by owner_id,lead_id)c on c.owner_id=a.owner_id and c.lead_id=a.lead_id
where a.voided_at is null group by a.owner_id,a.lead_id,c.last_connected_at;

create function private.route_lead(p_lead uuid,p_status public.lead_status) returns void language plpgsql security definer set search_path='' as $$
declare failed integer;begin
 select consecutive_failed_attempts into failed from public.lead_attempt_summary where lead_id=p_lead;
 update public.leads set status=p_status,
 archived_at=case when p_status='not_interested' or (p_status in('no_answer','voicemail') and coalesce(failed,0)>=3) then clock_timestamp() else null end,
 archive_reason=case when p_status='not_interested' then 'not_interested'::public.archive_reason when p_status in('no_answer','voicemail') and coalesce(failed,0)>=3 then 'attempts_exhausted'::public.archive_reason else null end,
 rejected_at=null,purge_after=null where id=p_lead;
 -- Completed tasks remain historical; other workflows never keep a pending duplicate.
 if p_status not in('follow_up','meeting_booked') then update public.followups set cancelled_at=clock_timestamp() where lead_id=p_lead and completed_at is null and cancelled_at is null;end if;
end $$;
create function private.schedule_followup(p_lead uuid,p_date date,p_time time,p_notes text,p_kind text default 'callback') returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;begin
 if p_date is null or p_kind not in('callback','meeting') then raise exception 'A follow-up date is required';end if;
 select f.id into v_id from public.followups f where lead_id=p_lead and completed_at is null and cancelled_at is null for update;
 if v_id is null then
  insert into public.followups(owner_id,lead_id,scheduled_date,scheduled_time,notes,kind,created_by_change) select owner_id,p_lead,p_date,p_time,coalesce(p_notes,''),p_kind,private.current_change(p_lead) from public.leads where leads.id=p_lead returning followups.id into v_id;
 else update public.followups set scheduled_date=p_date,scheduled_time=p_time,notes=coalesce(p_notes,''),kind=p_kind where followups.id=v_id;end if;
 return v_id;
end $$;

create function public.record_call(p_lead uuid,p_expected timestamptz,p_request uuid,p_outcome public.call_outcome,p_notes text default '',p_date date default null,p_time time default null,p_followup uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid;a uuid;s public.lead_status;begin
 c=private.start_change(p_lead,p_expected,'attempt',p_request);
 if (select after_updated_at is not null from public.workflow_changes where id=c) then return c;end if;
 if p_outcome is null or p_outcome='other' or octet_length(p_notes)>16000 then raise exception 'Invalid call outcome or notes';end if;
 if exists(select 1 from public.leads where id=p_lead and archived_at is not null) or public.is_lead_suppressed(p_lead) then raise exception 'Do-not-call or archived lead: outreach is blocked' using errcode='42501';end if;
 if p_outcome in('callback_requested','meeting_booked') and p_date is null then raise exception 'Choose a callback date';end if;
 if p_followup is not null and not exists(select 1 from public.followups where id=p_followup and lead_id=p_lead and owner_id=auth.uid() and completed_at is null and cancelled_at is null) then raise exception 'Follow-up changed. Reload before recording.';end if;
 insert into public.call_attempts(owner_id,lead_id,request_id,outcome,notes) values(auth.uid(),p_lead,p_request,p_outcome,coalesce(p_notes,'')) returning id into a;
 update public.workflow_changes set attempt_id=a where id=c;
 update public.followups set completed_at=clock_timestamp(),completion_outcome=p_outcome where lead_id=p_lead and completed_at is null and cancelled_at is null;
 s=case when p_outcome='callback_requested' then 'follow_up'::public.lead_status else p_outcome::text::public.lead_status end;
 perform private.route_lead(p_lead,s);
 if p_outcome in('callback_requested','meeting_booked') then perform private.schedule_followup(p_lead,p_date,p_time,p_notes,case when p_outcome='meeting_booked' then 'meeting' else 'callback' end);end if;
 perform private.finish_change(c);return c;
end $$;

-- Replace the Phase 3 editor RPC without changing its signature.
create or replace function public.save_lead(p_id uuid,p_expected timestamptz,p_data jsonb,p_action text default 'edit') returns void language plpgsql security definer set search_path='' as $$
declare c uuid;s public.lead_status;begin
 if p_action not in('edit','delete','archive','restore') or p_action is null or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Invalid lead action';end if;
 c=private.start_change(p_id,p_expected,case when p_action='edit' then 'lead_edit' else p_action end,gen_random_uuid());
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in('business_name','phone','website_url','country','location','notes','status','scheduled_date','scheduled_time')) then raise exception 'Invalid lead fields';end if;
 if p_action='delete' then
  update public.leads set deleted_at=clock_timestamp() where id=p_id;
  update public.followups set cancelled_at=clock_timestamp() where lead_id=p_id and completed_at is null and cancelled_at is null;
 elsif p_action='archive' then
  update public.leads set archived_at=clock_timestamp(),archive_reason='manual' where id=p_id;
  update public.followups set cancelled_at=clock_timestamp() where lead_id=p_id and completed_at is null and cancelled_at is null;
 elsif p_action='restore' then
  if (select status='not_interested' from public.leads where id=p_id) or public.is_lead_suppressed(p_id) then raise exception 'Rejected or do-not-call lead: correct the rejection through history first';end if;
  perform private.route_lead(p_id,'new');
 else
  update public.leads set business_name=coalesce(p_data->>'business_name',business_name),phone=case when p_data?'phone' then nullif(p_data->>'phone','') else phone end,website_url=case when p_data?'website_url' then nullif(p_data->>'website_url','') else website_url end,country=case when p_data?'country' then nullif(p_data->>'country','') else country end,location=case when p_data?'location' then nullif(p_data->>'location','') else location end,notes=coalesce(p_data->>'notes',notes) where id=p_id;
  if p_data?'status' then
   s=(p_data->>'status')::public.lead_status;
   if s is null then raise exception 'Status required';end if;
   if s is distinct from (select status from public.leads where id=p_id) then perform private.route_lead(p_id,s);end if;
   if s in('follow_up','meeting_booked') then
    if nullif(p_data->>'scheduled_date','') is not null then perform private.schedule_followup(p_id,(p_data->>'scheduled_date')::date,nullif(p_data->>'scheduled_time','')::time,coalesce(p_data->>'notes',''),case when s='meeting_booked' then 'meeting' else 'callback' end);
    elsif not exists(select 1 from public.followups where lead_id=p_id and completed_at is null and cancelled_at is null) then raise exception 'Choose a follow-up date';end if;
   end if;
  end if;
 end if;
 perform private.finish_change(c);
end $$;

create function public.manage_followup(p_lead uuid,p_expected timestamptz,p_request uuid,p_id uuid default null,p_action text default 'schedule',p_date date default null,p_time time default null,p_notes text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid;v_kind text;begin
 c=private.start_change(p_lead,p_expected,'followup',p_request);
 if (select after_updated_at is not null from public.workflow_changes where id=c) then return c;end if;
 if p_action not in('schedule','complete','cancel') or p_action is null or octet_length(p_notes)>16000 then raise exception 'Invalid follow-up action';end if;
 if p_action='schedule' and (exists(select 1 from public.leads where id=p_lead and archived_at is not null) or public.is_lead_suppressed(p_lead)) then raise exception 'Archived or do-not-call lead: scheduling blocked';end if;
 if p_id is not null and not exists(select 1 from public.followups where id=p_id and lead_id=p_lead and owner_id=auth.uid()) then raise exception 'Follow-up unavailable' using errcode='42501';end if;
 if p_action='schedule' then
  select kind into v_kind from public.followups where id=p_id and lead_id=p_lead;
  v_kind=coalesce(v_kind,'callback');
  perform private.route_lead(p_lead,case when v_kind='meeting' then 'meeting_booked'::public.lead_status else 'follow_up'::public.lead_status end);
  perform private.schedule_followup(p_lead,p_date,p_time,p_notes,v_kind);
 else
  if p_id is null then raise exception 'Follow-up required';end if;
  if not exists(select 1 from public.followups where id=p_id and completed_at is null and cancelled_at is null) then raise exception 'Task is no longer pending';end if;
  if p_action='complete' then update public.followups set completed_at=clock_timestamp() where id=p_id;
  else update public.followups set cancelled_at=clock_timestamp() where id=p_id;end if;
  perform private.route_lead(p_lead,'interested');
 end if;
 perform private.finish_change(c);return c;
end $$;

create function public.undo_workflow(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();c public.workflow_changes%rowtype;l public.leads%rowtype;b jsonb;f jsonb;latest uuid;current_tasks jsonb;source uuid;begin
 perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 select * into c from public.workflow_changes where id=p_id and owner_id=u for update;
 if not found then raise exception 'Change unavailable' using errcode='42501';end if;
 if c.undone_at is not null then return;end if;
 select * into l from public.leads where id=c.lead_id and owner_id=u for update;
 if not found or l.updated_at is distinct from c.after_updated_at then raise exception 'Lead changed. Undo newer changes first.';end if;
 select id into latest from public.workflow_changes where lead_id=c.lead_id and owner_id=u and undone_at is null order by sequence desc limit 1;
 if latest<>c.id then raise exception 'Undo newer changes first';end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') into current_tasks from public.followups t where t.owner_id=u and t.lead_id=c.lead_id and (t.created_by_change=c.id or t.id in(select (x->>'id')::uuid from jsonb_array_elements(c.before_followups)x));
 if current_tasks<>c.after_followups then raise exception 'Follow-up changed; correction blocked';end if;
 b=c.before_data;
 -- Remove only the suppression sources belonging to this explicitly corrected rejection.
 if l.rejection_source is not null and l.rejection_source is distinct from nullif(b->>'rejection_source','')::uuid then
  source=l.rejection_source;
  delete from private.suppression_sources where owner_id=u and source_id=source;
  delete from public.outreach_suppressions s where s.owner_id=u and not exists(select 1 from private.suppression_sources r where r.owner_id=s.owner_id and r.identifier_kind=s.identifier_kind and r.fingerprint=s.fingerprint);
 end if;
 if c.attempt_id is not null then update public.call_attempts set voided_at=clock_timestamp() where id=c.attempt_id and owner_id=u;end if;
 update public.activity_events set voided_at=clock_timestamp() where owner_id=u and change_id=c.id and voided_at is null;
 delete from public.followups where lead_id=c.lead_id and owner_id=u and created_by_change=c.id;
 for f in select value from jsonb_array_elements(c.before_followups) loop
  update public.followups set scheduled_date=(f->>'scheduled_date')::date,scheduled_time=(f->>'scheduled_time')::time,kind=f->>'kind',notes=f->>'notes',completed_at=(f->>'completed_at')::timestamptz,cancelled_at=(f->>'cancelled_at')::timestamptz,completion_outcome=(f->>'completion_outcome')::public.call_outcome where id=(f->>'id')::uuid and owner_id=u;
 end loop;
 perform set_config('folio.undo_id',c.id::text,true);
 update public.leads set business_name=b->>'business_name',phone=b->>'phone',website_url=b->>'website_url',country=b->>'country',location=b->>'location',notes=b->>'notes',status=(b->>'status')::public.lead_status,last_contacted_at=(b->>'last_contacted_at')::timestamptz,archived_at=(b->>'archived_at')::timestamptz,archive_reason=(b->>'archive_reason')::public.archive_reason,rejected_at=(b->>'rejected_at')::timestamptz,purge_after=(b->>'purge_after')::timestamptz,deleted_at=(b->>'deleted_at')::timestamptz,rejection_source=(b->>'rejection_source')::uuid where id=c.lead_id and owner_id=u;
 perform set_config('folio.undo_id','',true);
 update public.workflow_changes set undone_at=clock_timestamp() where id=c.id;
 insert into public.activity_events(owner_id,subject_id,lead_id,kind,source_id) values(u,l.subject_id,l.id,'change_reverted',c.id);
 -- Permit sequential corrections without losing timestamp conflict protection.
 select id into latest from public.workflow_changes where lead_id=c.lead_id and owner_id=u and undone_at is null order by sequence desc limit 1;
 if latest is not null then
  update public.workflow_changes w set after_updated_at=(select updated_at from public.leads where id=c.lead_id),after_followups=coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.followups t where t.lead_id=c.lead_id and t.owner_id=u and (t.created_by_change=w.id or t.id in(select (x->>'id')::uuid from jsonb_array_elements(w.before_followups)x))),'[]') where w.id=latest;
 end if;
end $$;

-- All workflow mutations must pass the validated transactional RPCs.
revoke insert on public.call_attempts from authenticated;
revoke insert(lead_id,request_id,outcome,notes) on public.call_attempts from authenticated;
revoke insert(lead_id,scheduled_date,scheduled_time,kind,notes),update(scheduled_date,scheduled_time,notes) on public.followups from authenticated;
revoke update(status) on public.leads from authenticated;

create or replace function public.daily_activity(p_day date) returns table(calls_made bigint,businesses_contacted bigint,unanswered_calls bigint,voicemails bigint,interested_prospects bigint,meetings_booked bigint,callbacks_requested bigint,followups_scheduled bigint) language sql stable security invoker set search_path='' as $$
 select count(*) filter(where kind='call_attempt'),count(distinct subject_id) filter(where kind='call_attempt'),count(*) filter(where kind='call_attempt' and outcome='no_answer'),count(*) filter(where kind='call_attempt' and outcome='voicemail'),count(distinct subject_id) filter(where kind='call_attempt' and outcome='interested'),count(*) filter(where kind='meeting_scheduled'),count(*) filter(where kind='call_attempt' and outcome='callback_requested'),count(*) filter(where kind in('followup_scheduled','meeting_scheduled')) from public.activity_events where owner_id=(select auth.uid()) and voided_at is null and occurred_at>=(p_day::timestamp at time zone 'UTC') and occurred_at<((p_day+1)::timestamp at time zone 'UTC')
$$;

create function private.purge_rejected_leads(p_limit integer default 500) returns integer language plpgsql security definer set search_path='' as $$
declare n integer;targets uuid[];begin
 select array_agg(id) into targets from(select id from public.leads where status='not_interested' and archive_reason='not_interested' and purge_after<=clock_timestamp() order by purge_after,id limit least(greatest(p_limit,1),500) for update skip locked)t;
 insert into public.activity_events(owner_id,subject_id,kind,source_id) select owner_id,subject_id,'lead_purged',id from public.leads where id=any(targets);
 delete from public.leads where id=any(targets);
 get diagnostics n=row_count;return n;
end $$;
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.record_call(uuid,timestamptz,uuid,public.call_outcome,text,date,time,uuid),public.manage_followup(uuid,timestamptz,uuid,uuid,text,date,time,text),public.undo_workflow(uuid) from public,anon,authenticated;
grant execute on function public.record_call(uuid,timestamptz,uuid,public.call_outcome,text,date,time,uuid),public.manage_followup(uuid,timestamptz,uuid,uuid,text,date,time,text),public.undo_workflow(uuid) to authenticated;

create or replace function public.workspace_leads(p_page uuid default null,p_mode text default 'page',p_search text default '',p_status text default 'all',p_phone boolean default false,p_sort text default 'newest',p_offset integer default 0,p_limit integer default 8)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;begin
 if p_mode not in ('page','attempts','archive') or p_sort not in ('newest','name','attempts') or p_offset<0 or p_offset>1000000 or p_limit<1 or p_limit>100 or length(p_search)>200 then raise exception 'Invalid list parameters';end if;
 with eligible as (
 select l.* from public.leads l join public.lead_pages p on p.id=l.page_id and p.owner_id=l.owner_id
 where l.owner_id=(select auth.uid()) and l.deleted_at is null and p.deleted_at is null
 and (p_mode<>'page' or (l.page_id=p_page and l.status in ('new','interested')))
 and (case when p_mode='archive' then l.archived_at is not null else l.archived_at is null end)
 and (p_mode<>'attempts' or l.status in ('no_answer','voicemail'))
 ), filtered as (
 select e.*,coalesce(a.total_attempts,0) as attempts,coalesce(a.consecutive_failed_attempts,0) as failed_attempts,a.last_attempt_at,(select notes from public.call_attempts ca where ca.lead_id=e.id and ca.owner_id=e.owner_id and ca.voided_at is null order by occurred_at desc,id desc limit 1) as last_attempt_notes,public.is_lead_suppressed(e.id) as suppressed,f.scheduled_date as followup,f.scheduled_time as followup_time
 from eligible e left join public.lead_attempt_summary a on a.lead_id=e.id and a.owner_id=e.owner_id
 left join public.followups f on f.owner_id=e.owner_id and f.lead_id=e.id and f.completed_at is null and f.cancelled_at is null
 where (p_status='all' or e.status::text=p_status) and (not p_phone or nullif(btrim(e.phone),'') is not null)
 and (p_search='' or e.business_name ilike '%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%'
 or e.phone ilike '%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%'
 or (regexp_replace(p_search,'[^0-9+]','','g')<>'' and regexp_replace(coalesce(e.phone,''),'[^0-9+]','','g') like '%'||regexp_replace(p_search,'[^0-9+]','','g')||'%'))
 ), paged as (
 select * from filtered order by case when p_sort='name' then lower(business_name) end asc,
 case when p_sort='attempts' then attempts end desc,created_at desc,id limit p_limit offset p_offset
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'),
 'total',(select count(*) from filtered),'summary',jsonb_build_object('total',(select count(*) from eligible),
 'ready',(select count(*) from eligible where status='new' and nullif(btrim(phone),'') is not null),
 'contacted',(select count(*) from eligible where last_contacted_at is not null),
 'unanswered',(select count(*) from eligible where status='no_answer'))) into result;
 return result;end $$;

create function public.workspace_followups(p_day date,p_category text default 'all',p_sort text default 'asc',p_offset integer default 0,p_limit integer default 20) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;begin
 if p_day is null or p_category not in('all','overdue','today','upcoming','completed') or p_sort not in('asc','desc') or p_offset<0 or p_limit not between 1 and 100 then raise exception 'Invalid follow-up list parameters';end if;
 with eligible as(
 select f.*,case when f.completed_at is not null then 'completed' when f.scheduled_date<p_day then 'overdue' when f.scheduled_date=p_day then 'today' else 'upcoming' end category,
 to_jsonb(l)||jsonb_build_object('attempts',coalesce(a.total_attempts,0),'failed_attempts',coalesce(a.consecutive_failed_attempts,0),'last_attempt_at',a.last_attempt_at,'suppressed',public.is_lead_suppressed(l.id),'followup',f.scheduled_date,'followup_time',f.scheduled_time) lead
 from public.followups f join public.leads l on l.id=f.lead_id and l.owner_id=f.owner_id join public.lead_pages p on p.id=l.page_id and p.owner_id=l.owner_id
 left join public.lead_attempt_summary a on a.lead_id=l.id and a.owner_id=l.owner_id
 where f.owner_id=auth.uid() and f.cancelled_at is null and l.deleted_at is null and p.deleted_at is null and (f.completed_at is not null or (l.archived_at is null and l.status in('follow_up','meeting_booked')))
 ),filtered as(select * from eligible where p_category='all' or category=p_category),paged as(
 select * from filtered order by case when p_sort='asc' then scheduled_date end asc,case when p_sort='desc' then scheduled_date end desc,scheduled_time nulls last,id limit p_limit offset p_offset)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'),'total',(select count(*) from filtered),'counts',jsonb_build_object('all',(select count(*) from eligible),'overdue',(select count(*) from eligible where category='overdue'),'today',(select count(*) from eligible where category='today'),'upcoming',(select count(*) from eligible where category='upcoming'),'completed',(select count(*) from eligible where category='completed'))) into result;
 return result;end $$;

create function public.workspace_activity(p_day date,p_offset integer default 0,p_limit integer default 20) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;begin
 if p_day is null or p_offset<0 or p_limit not between 1 and 100 then raise exception 'Invalid activity parameters';end if;
 with events as(select e.*,coalesce(l.business_name,'Removed business') business_name,coalesce(a.notes,'') notes,coalesce(l.location,'') location from public.activity_events e left join public.leads l on l.id=e.lead_id and l.owner_id=e.owner_id left join public.call_attempts a on a.id=e.attempt_id and a.owner_id=e.owner_id where e.owner_id=auth.uid() and e.occurred_at>=(p_day::timestamp at time zone 'UTC') and e.occurred_at<((p_day+1)::timestamp at time zone 'UTC')),
 paged as(select * from events order by occurred_at desc,id desc limit p_limit offset p_offset)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'),'total',(select count(*) from events),'summary',(select to_jsonb(d) from public.daily_activity(p_day)d),'connected',(select count(*) from events where kind='call_attempt' and outcome not in('no_answer','voicemail') and voided_at is null)) into result;
 return result;end $$;

create function public.workspace_lead_history(p_lead uuid,p_offset integer default 0,p_limit integer default 10) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;begin
 if p_offset<0 or p_limit not between 1 and 100 or not exists(select 1 from public.leads where id=p_lead and owner_id=auth.uid()) then raise exception 'Lead unavailable' using errcode='42501';end if;
 with attempts as(select * from public.call_attempts where lead_id=p_lead and owner_id=auth.uid()),paged as(select * from attempts order by occurred_at desc,id desc limit p_limit offset p_offset),changes as(select id,kind,attempt_id,created_at,undone_at from public.workflow_changes where lead_id=p_lead and owner_id=auth.uid() order by sequence desc limit 10)
 select jsonb_build_object('attempts',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'),'total',(select count(*) from attempts),'changes',coalesce((select jsonb_agg(to_jsonb(changes)) from changes),'[]'),'undo_id',(select id from public.workflow_changes where lead_id=p_lead and owner_id=auth.uid() and undone_at is null order by sequence desc limit 1)) into result;
 return result;end $$;

create function public.workspace_overview(p_day date) returns jsonb language sql stable security invoker set search_path='' as $$
 with leads as(select l.* from public.leads l join public.lead_pages p on p.id=l.page_id and p.owner_id=l.owner_id where l.owner_id=auth.uid() and l.deleted_at is null and p.deleted_at is null and l.archived_at is null),
 days as(select p_day-6+n as activity_day from generate_series(0,6)n),daily as(select activity_day,(select count(*) from public.activity_events e where e.owner_id=auth.uid() and e.kind='call_attempt' and e.voided_at is null and e.occurred_at>=(activity_day::timestamp at time zone 'UTC') and e.occurred_at<((activity_day+1)::timestamp at time zone 'UTC')) calls from days order by activity_day),
 recent as(select e.*,coalesce(l.business_name,'Removed business') business_name from public.activity_events e left join public.leads l on l.id=e.lead_id and l.owner_id=e.owner_id where e.owner_id=auth.uid() order by e.occurred_at desc,e.id desc limit 5)
 select jsonb_build_object('active',(select count(*) from leads),'interested',(select count(*) from leads where status='interested'),'unanswered',(select count(*) from leads where status='no_answer'),'followups',(select count(*) from public.followups f join leads l on l.id=f.lead_id where f.owner_id=auth.uid() and f.completed_at is null and f.cancelled_at is null),'due_today',(select count(*) from public.followups f join leads l on l.id=f.lead_id where f.owner_id=auth.uid() and f.completed_at is null and f.cancelled_at is null and f.scheduled_date=p_day),'meetings',(select count(*) from public.activity_events where owner_id=auth.uid() and kind='meeting_scheduled' and voided_at is null),'today',(select to_jsonb(d) from public.daily_activity(p_day)d),'daily',(select jsonb_agg(to_jsonb(daily)) from daily),'recent',coalesce((select jsonb_agg(to_jsonb(recent)) from recent),'[]'))
$$;
revoke all on function public.workspace_followups(date,text,text,integer,integer),public.workspace_activity(date,integer,integer),public.workspace_lead_history(uuid,integer,integer),public.workspace_overview(date) from public,anon,authenticated;
grant execute on function public.workspace_followups(date,text,text,integer,integer),public.workspace_activity(date,integer,integer),public.workspace_lead_history(uuid,integer,integer),public.workspace_overview(date) to authenticated;



create function private.initial_followup() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in('follow_up','meeting_booked') then
 insert into public.followups(owner_id,lead_id,scheduled_date,kind,notes,auto_from_import) values(new.owner_id,new.id,(clock_timestamp() at time zone 'UTC')::date,case when new.status='meeting_booked' then 'meeting' else 'callback' end,'Imported schedule: please confirm the date. '||left(new.notes,1000),new.import_id);
 end if;return new;end $$;
create trigger initial_followup after insert on public.leads for each row execute function private.initial_followup();
insert into public.followups(owner_id,lead_id,scheduled_date,kind,notes,auto_from_import)
select l.owner_id,l.id,(clock_timestamp() at time zone 'UTC')::date,case when l.status='meeting_booked' then 'meeting' else 'callback' end,'Imported schedule: please confirm the date. '||left(l.notes,1000),l.import_id from public.leads l where l.status in('follow_up','meeting_booked') and l.archived_at is null and l.deleted_at is null and not exists(select 1 from public.followups f where f.lead_id=l.id and f.completed_at is null and f.cancelled_at is null);
revoke all on function private.initial_followup() from public,anon,authenticated;
create or replace function public.undo_import(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();b public.imports%rowtype;begin
 perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 select * into b from public.imports where id=p_id and owner_id=u for update;
 if not found then raise exception 'Import unavailable' using errcode='42501';end if;
 if b.status='rolled_back' then return;end if;
 if b.status<>'completed' then raise exception 'Import not completed';end if;
 if not exists(select 1 from public.lead_pages where id=b.page_id and owner_id=u and deleted_at is null) then raise exception 'Page has been deleted';end if;
 if exists(select 1 from public.imports where page_id=b.page_id and owner_id=u and batch_sequence>b.batch_sequence and status='completed') then raise exception 'Undo newer imports on this page first';end if;
 perform 1 from public.leads where id in(select lead_id from public.import_members where import_id=b.id) for update;
 if (select count(*) from public.import_members where import_id=b.id and role='inserted')<>b.successful_rows or (select count(*) from public.import_members where import_id=b.id and role='replaced')<>b.replaced_count then raise exception 'Import records have changed; undo would lose data';end if;
 if exists(select 1 from public.import_members m join public.leads l on l.id=m.lead_id where m.import_id=b.id and (l.updated_at<>m.expected_updated_at or l.deleted_at is distinct from m.expected_deleted_at)) then raise exception 'Leads changed since import; undo blocked to protect your changes';end if;
 if exists(select 1 from public.import_members m where m.import_id=b.id and m.role='inserted' and (exists(select 1 from public.call_attempts where lead_id=m.lead_id) or exists(select 1 from public.followups where lead_id=m.lead_id and not(auto_from_import is not distinct from b.id and updated_at=created_at and completed_at is null and cancelled_at is null)))) then raise exception 'Imported leads have calling history or follow-ups; undo blocked';end if;
 update public.activity_events set voided_at=clock_timestamp() where owner_id=u and kind in('followup_scheduled','meeting_scheduled') and source_id in(select id from public.followups where auto_from_import=b.id and updated_at=created_at and completed_at is null and cancelled_at is null);
 delete from public.leads where id in(select lead_id from public.import_members where import_id=b.id and role='inserted');
 update public.leads set deleted_at=null where id in(select lead_id from public.import_members where import_id=b.id and role='replaced');
 -- Restoring an earlier import changes timestamps; update that earlier batch's safe baseline.
 update public.import_members m set expected_updated_at=l.updated_at,expected_deleted_at=l.deleted_at from public.leads l
 where m.lead_id=l.id and m.import_id<>b.id and l.id in(select lead_id from public.import_members where import_id=b.id and role='replaced');
 update public.imports set status='rolled_back' where id=b.id and owner_id=u;
end $$;


create or replace function public.workspace_pages() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]') from (
 select p.id,p.name,p.description,p.created_at,
 count(l.id) filter(where l.archived_at is null)::integer as lead_count,
 count(l.id) filter(where l.archived_at is null and l.status='new')::integer as new_count,
 count(l.id) filter(where l.archived_at is null and l.last_contacted_at is not null)::integer as contacted_count,
 count(l.id) filter(where l.archived_at is null and l.status in('follow_up','meeting_booked'))::integer as followup_count
 from public.lead_pages p left join public.leads l on l.page_id=p.id and l.owner_id=p.owner_id and l.deleted_at is null
 where p.owner_id=(select auth.uid()) and p.deleted_at is null group by p.id) x
$$;

