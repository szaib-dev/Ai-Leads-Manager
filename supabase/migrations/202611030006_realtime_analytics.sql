-- Phase 5: one PII-free change signal per owner/transaction, not one event per imported row.
create table public.workspace_sync (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 revision bigint not null default 1,
 last_transaction bigint not null,
 updated_at timestamptz not null default clock_timestamp()
);
alter table public.workspace_sync enable row level security;
revoke all on public.workspace_sync from public,anon,authenticated;
grant select on public.workspace_sync to authenticated;
create policy owner_select on public.workspace_sync for select to authenticated using(owner_id=(select auth.uid()));
insert into public.workspace_sync(owner_id,last_transaction) select id,txid_current() from auth.users;
create function private.signal_workspace_change() returns trigger language plpgsql security definer set search_path='' as $$
declare u uuid;begin
 if tg_op='DELETE' then u=old.owner_id;else u=new.owner_id;end if;
 -- Auth-account deletion cascades must not recreate an orphan signal.
 if exists(select 1 from auth.users where id=u) then
  insert into public.workspace_sync(owner_id,last_transaction) values(u,txid_current())
  on conflict(owner_id) do update set revision=public.workspace_sync.revision+1,last_transaction=excluded.last_transaction,updated_at=clock_timestamp()
  where public.workspace_sync.last_transaction<>excluded.last_transaction;
 end if;
 return null;
end $$;
do $$declare t text;begin
 foreach t in array array['lead_pages','leads','imports','call_attempts','followups','activity_events','outreach_suppressions'] loop
 execute format('create trigger workspace_signal after insert or update or delete on public.%I for each row execute function private.signal_workspace_change()',t);
 end loop;
 -- Never publish business data or DELETE payloads (DELETE cannot be authorized against a gone row).
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
  create publication supabase_realtime with(publish='insert,update');
 end if;
 if exists(select 1 from pg_publication where pubname='supabase_realtime' and puballtables) or exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and (schemaname<>'public' or tablename<>'workspace_sync')) then
  raise exception 'Review unrelated existing Realtime publication tables before applying Phase 5';
 end if;
 alter publication supabase_realtime set(publish='insert,update');
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='workspace_sync') then alter publication supabase_realtime add table public.workspace_sync;end if;
end $$;
revoke all on function private.signal_workspace_change() from public,anon,authenticated;

-- Durable page attribution and frozen attempt ordinals contain no business details.
alter table public.call_attempts add column attempt_number integer;
alter table public.call_attempts disable trigger immutable_attempt;
with ranked as(select id,row_number() over(partition by owner_id,lead_id order by occurred_at,id)::integer n from public.call_attempts)
update public.call_attempts a set attempt_number=r.n from ranked r where a.id=r.id;
alter table public.call_attempts enable trigger immutable_attempt;
alter table public.call_attempts alter column attempt_number set not null;
alter table public.call_attempts add check(attempt_number>0);
create unique index attempts_number_unique on public.call_attempts(owner_id,lead_id,attempt_number);
alter table public.activity_events add column page_id uuid;
alter table public.activity_events add foreign key(page_id,owner_id) references public.lead_pages(id,owner_id) on delete set null(page_id);
alter table public.activity_events add column attempt_number integer check(attempt_number>0);
update public.activity_events e set page_id=l.page_id from public.leads l where e.lead_id=l.id and e.owner_id=l.owner_id;
update public.activity_events e set attempt_number=a.attempt_number from public.call_attempts a where e.attempt_id=a.id and e.owner_id=a.owner_id;
create index activity_page_time_idx on public.activity_events(owner_id,page_id,occurred_at desc,id);
create function private.number_attempt() returns trigger language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||new.owner_id::text,0));
 select coalesce(max(attempt_number),0)+1 into new.attempt_number from public.call_attempts where owner_id=new.owner_id and lead_id=new.lead_id;
 return new;end $$;
create trigger number_attempt before insert on public.call_attempts for each row execute function private.number_attempt();
create function private.attribute_event() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.lead_id is not null then select page_id into new.page_id from public.leads where id=new.lead_id and owner_id=new.owner_id;end if;
 if new.attempt_id is not null then select attempt_number into new.attempt_number from public.call_attempts where id=new.attempt_id and owner_id=new.owner_id;end if;
 return new;end $$;
create trigger attribute_event before insert on public.activity_events for each row execute function private.attribute_event();
revoke all on function private.number_attempt(),private.attribute_event() from public,anon,authenticated;

-- One MVCC snapshot for summaries and the subscription checkpoint.
create function public.workspace_state() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('pages',public.workspace_pages(),'revision',coalesce((select revision from public.workspace_sync where owner_id=auth.uid()),0))
$$;
create function public.analytics_report(p_from date,p_to date,p_timezone text default 'Asia/Karachi',p_page uuid default null) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;start_at timestamptz;end_at timestamptz;begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365 or not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Choose a valid timezone and date range of at most 366 days';end if;
 if p_page is not null and not exists(select 1 from public.lead_pages where id=p_page and owner_id=auth.uid()) then raise exception 'Page unavailable' using errcode='42501';end if;
 start_at=p_from::timestamp at time zone p_timezone;end_at=(p_to+1)::timestamp at time zone p_timezone;
 with facts as materialized(select * from public.activity_events where owner_id=auth.uid() and occurred_at>=start_at and occurred_at<end_at and (p_page is null or page_id=p_page)),
 stats as(select count(*) filter(where kind='call_attempt' and voided_at is null) attempts,
 count(distinct subject_id) filter(where kind='call_attempt' and voided_at is null) businesses_contacted,
 count(*) filter(where kind='call_attempt' and voided_at is null and outcome not in('no_answer','voicemail')) answered,
 count(*) filter(where kind='call_attempt' and voided_at is null and outcome='no_answer') unanswered,
 count(*) filter(where kind='call_attempt' and voided_at is null and outcome='voicemail') voicemails,
 count(distinct subject_id) filter(where kind='call_attempt' and voided_at is null and outcome='interested') interested,
 count(*) filter(where kind='call_attempt' and voided_at is null and outcome='not_interested') rejected,
 count(*) filter(where kind in('followup_scheduled','meeting_scheduled') and voided_at is null) followups,
 count(*) filter(where kind='meeting_scheduled' and voided_at is null) meetings,
 count(*) filter(where kind='call_attempt' and voided_at is null and outcome='callback_requested') callbacks from facts),
 summary as(select to_jsonb(s)||jsonb_build_object('answer_rate',coalesce(round(answered*100.0/nullif(attempts,0),1),0),'conversion_rate',coalesce(round(interested*100.0/nullif(businesses_contacted,0),1),0)) data from stats s),
 current_leads as(select l.* from public.leads l join public.lead_pages p on p.id=l.page_id and p.owner_id=l.owner_id where l.owner_id=auth.uid() and l.deleted_at is null and p.deleted_at is null and (p_page is null or l.page_id=p_page)),
 current_counts as(select jsonb_build_object('active',count(*) filter(where archived_at is null),'interested',count(*) filter(where archived_at is null and status='interested'),'unanswered',count(*) filter(where archived_at is null and status in('no_answer','voicemail')),'archived',count(*) filter(where archived_at is not null),'scheduled',(select count(*) from public.followups f join current_leads l on l.id=f.lead_id where f.owner_id=auth.uid() and f.completed_at is null and f.cancelled_at is null and l.archived_at is null)) data from current_leads),
 days as(select p_from+n day_key from generate_series(0,p_to-p_from)n),
 daily_counts as(select (occurred_at at time zone p_timezone)::date day_key,count(*) calls from facts where kind='call_attempt' and voided_at is null group by 1),
 daily as(select d.day_key,coalesce(c.calls,0) calls from days d left join daily_counts c using(day_key) order by d.day_key),
 recent as(select e.id,e.lead_id,e.kind,e.occurred_at,e.outcome,e.from_status,e.to_status,e.voided_at,e.attempt_number,coalesce(l.business_name,'Removed business') business_name from facts e left join public.leads l on l.id=e.lead_id and l.owner_id=e.owner_id order by e.occurred_at desc,e.id desc limit 5)
 select jsonb_build_object('summary',(select data from summary),'current',(select data from current_counts),'daily',(select jsonb_agg(to_jsonb(daily)) from daily),'recent',coalesce((select jsonb_agg(to_jsonb(recent)) from recent),'[]'),'start_at',start_at,'end_at',end_at,'timezone',p_timezone) into result;
 return result;end $$;
create function public.activity_range(p_from date,p_to date,p_timezone text default 'Asia/Karachi',p_page uuid default null,p_offset integer default 0,p_limit integer default 20) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;report jsonb;begin
 if p_offset<0 or p_offset>1000000 or p_limit not between 1 and 100 then raise exception 'Invalid pagination';end if;
 report=public.analytics_report(p_from,p_to,p_timezone,p_page);
 with events as(select e.id,e.lead_id,e.kind,e.occurred_at,e.outcome,e.from_status,e.to_status,e.voided_at,e.attempt_number,coalesce(l.business_name,'Removed business') business_name,coalesce(a.notes,'') notes,coalesce(l.location,'') location from public.activity_events e left join public.leads l on l.id=e.lead_id and l.owner_id=e.owner_id left join public.call_attempts a on a.id=e.attempt_id and a.owner_id=e.owner_id where e.owner_id=auth.uid() and e.occurred_at>=(report->>'start_at')::timestamptz and e.occurred_at<(report->>'end_at')::timestamptz and (p_page is null or e.page_id=p_page)),
 paged as(select * from events order by occurred_at desc,id desc limit p_limit offset p_offset)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'),'total',(select count(*) from events),'summary',report->'summary') into result;
 return result;end $$;
revoke all on function public.workspace_state(),public.analytics_report(date,date,text,uuid),public.activity_range(date,date,text,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.workspace_state(),public.analytics_report(date,date,text,uuid),public.activity_range(date,date,text,uuid,integer,integer) to authenticated;

create or replace function private.purge_rejected_leads(p_limit integer default 500) returns integer language plpgsql security definer set search_path='' as $$
declare n integer;targets uuid[];begin
 select array_agg(id) into targets from(select id from public.leads where status='not_interested' and archive_reason='not_interested' and purge_after<=clock_timestamp() order by purge_after,id limit least(greatest(p_limit,1),500) for update skip locked)t;
 insert into public.activity_events(owner_id,subject_id,page_id,kind,source_id) select owner_id,subject_id,page_id,'lead_purged',id from public.leads where id=any(targets);
 delete from public.leads where id=any(targets);
 get diagnostics n=row_count;return n;
end $$;
revoke all on function private.purge_rejected_leads(integer) from public,anon,authenticated;
