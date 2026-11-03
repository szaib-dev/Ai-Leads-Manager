create function private.touch_updated_at() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at = clock_timestamp(); return new; end $$;
create trigger lead_pages_updated before update on public.lead_pages for each row execute function private.touch_updated_at();
create trigger followups_updated before update on public.followups for each row execute function private.touch_updated_at();
create trigger preferences_updated before update on public.workspace_preferences for each row execute function private.touch_updated_at();

-- A unique index alone allows ON CONFLICT DO UPDATE to overwrite the original.
-- Serialize Maps-bearing lead creation per owner, then skip an exact existing URL
-- BEFORE any conflict-update can run. The comparison is raw equality, never a hash.
-- One transaction lock per owner also avoids thousands of per-URL advisory locks on CSV batches.
create function private.preserve_maps_original() returns trigger language plpgsql volatile security definer set search_path='' as $$
begin
  if new.google_maps_url is not null then
    perform pg_advisory_xact_lock(hashtextextended('folio:maps:' || new.owner_id::text,0));
    if exists(select 1 from public.leads where owner_id=new.owner_id and google_maps_url=new.google_maps_url collate "C") then
      return null;
    end if;
  end if;
  return new;
end $$;
create trigger preserve_maps_original before insert on public.leads for each row execute function private.preserve_maps_original();

create function private.lead_lifecycle() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op = 'UPDATE' and (new.id <> old.id or new.owner_id <> old.owner_id or new.subject_id <> old.subject_id or new.created_at <> old.created_at or new.google_maps_url is distinct from old.google_maps_url or new.import_id is distinct from old.import_id) then
    raise exception 'Lead identity and provenance are immutable' using errcode='23514';
  end if;
  new.updated_at = clock_timestamp();
  if new.status = 'not_interested' then
    if tg_op = 'INSERT' then new.rejected_at = clock_timestamp();
    elsif old.status <> 'not_interested' then new.rejected_at = clock_timestamp();
    else new.rejected_at = old.rejected_at;
    end if;
    new.archived_at = new.rejected_at;
    new.archive_reason = 'not_interested';
    new.purge_after = new.rejected_at + interval '480 hours';
  elsif tg_op = 'UPDATE' and old.archive_reason = 'not_interested' then
    new.archived_at = null; new.archive_reason = null; new.rejected_at = null; new.purge_after = null;
  end if;
  return new;
end $$;
create trigger lead_lifecycle before insert or update on public.leads for each row execute function private.lead_lifecycle();

-- Only explicit international numbers. No inferred country codes or fuzzy phone matching.
create function private.canonical_phone(value text) returns text language sql immutable set search_path='' as $$
  select case when regexp_replace(value,'[[:space:]().-]','','g') ~ '^\+[1-9][0-9]{6,14}$'
    then regexp_replace(value,'[[:space:]().-]','','g') else null end
$$;
create function private.remember_rejection() returns trigger language plpgsql security definer set search_path='' as $$
declare secret_value bytea; phone_value text;
begin
  if new.status <> 'not_interested' then return new; end if;
  insert into private.suppression_keys(owner_id) values (new.owner_id) on conflict do nothing;
  select secret into secret_value from private.suppression_keys where owner_id=new.owner_id;
  phone_value = private.canonical_phone(new.phone);
  if phone_value is not null then
    insert into public.outreach_suppressions(owner_id,identifier_kind,fingerprint)
      values(new.owner_id,'phone',extensions.hmac(convert_to(phone_value,'UTF8'),secret_value,'sha256')) on conflict do nothing;
  end if;
  if new.google_maps_url is not null then
    insert into public.outreach_suppressions(owner_id,identifier_kind,fingerprint)
      values(new.owner_id,'maps_url',extensions.hmac(convert_to(new.google_maps_url,'UTF8'),secret_value,'sha256')) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger remember_rejection after insert or update of status,phone,google_maps_url on public.leads for each row execute function private.remember_rejection();

create function public.is_lead_suppressed(p_lead_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare item public.leads%rowtype; secret_value bytea; phone_value text;
begin
  select * into item from public.leads where id=p_lead_id and owner_id=(select auth.uid());
  if not found then return false; end if;
  select secret into secret_value from private.suppression_keys where owner_id=item.owner_id;
  if secret_value is null then return false; end if;
  phone_value=private.canonical_phone(item.phone);
  return exists (select 1 from public.outreach_suppressions s where s.owner_id=item.owner_id and
    ((s.identifier_kind='phone' and phone_value is not null and s.fingerprint=extensions.hmac(convert_to(phone_value,'UTF8'),secret_value,'sha256'))
    or (s.identifier_kind='maps_url' and item.google_maps_url is not null and s.fingerprint=extensions.hmac(convert_to(item.google_maps_url,'UTF8'),secret_value,'sha256'))));
end $$;

create function private.record_attempt_fact() returns trigger language plpgsql security definer set search_path='' as $$
declare subject uuid;
begin
  select subject_id into strict subject from public.leads where id=new.lead_id and owner_id=new.owner_id;
  insert into public.activity_events(owner_id,subject_id,lead_id,attempt_id,kind,source_id,outcome,occurred_at)
    values(new.owner_id,subject,new.lead_id,new.id,'call_attempt',new.id,new.outcome,new.occurred_at);
  update public.leads set last_contacted_at=greatest(last_contacted_at,new.occurred_at) where id=new.lead_id and owner_id=new.owner_id;
  -- Complete status/outreach workflow and exhausted-call archiving are deferred to Phase 4.
  return new;
end $$;
create trigger record_attempt_fact after insert on public.call_attempts for each row execute function private.record_attempt_fact();

create function private.record_followup_fact() returns trigger language plpgsql security definer set search_path='' as $$
declare subject uuid;
begin
  select subject_id into strict subject from public.leads where id=new.lead_id and owner_id=new.owner_id;
  insert into public.activity_events(owner_id,subject_id,lead_id,kind,source_id,occurred_at)
    values(new.owner_id,subject,new.lead_id,case when new.kind='meeting' then 'meeting_scheduled'::public.event_kind else 'followup_scheduled'::public.event_kind end,new.id,new.created_at);
  return new;
end $$;
create trigger record_followup_fact after insert on public.followups for each row execute function private.record_followup_fact();

create function private.immutable_attempt() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Call attempts are immutable; corrections require a future compensating event' using errcode='23514'; end $$;
create trigger immutable_attempt before update on public.call_attempts for each row execute function private.immutable_attempt();

create view public.lead_attempt_summary with (security_invoker=true) as
select a.owner_id,a.lead_id,count(*)::integer as total_attempts,
  count(*) filter(where a.outcome in ('no_answer','voicemail'))::integer as failed_attempts,
  count(*) filter(where a.outcome in ('no_answer','voicemail') and a.occurred_at > coalesce(c.last_connected_at,'-infinity'::timestamptz))::integer as consecutive_failed_attempts,
  (array_agg(a.outcome order by a.occurred_at desc,a.id desc))[1] as latest_outcome,
  max(a.occurred_at) as last_attempt_at
from public.call_attempts a
left join (select owner_id,lead_id,max(occurred_at) filter(where outcome not in ('no_answer','voicemail')) as last_connected_at from public.call_attempts group by owner_id,lead_id) c
  on c.owner_id=a.owner_id and c.lead_id=a.lead_id
group by a.owner_id,a.lead_id,c.last_connected_at;
revoke all on public.lead_attempt_summary from public,anon,authenticated;
grant select on public.lead_attempt_summary to authenticated;

create function public.daily_activity(p_day date)
returns table(calls_made bigint,businesses_contacted bigint,unanswered_calls bigint,voicemails bigint,interested_prospects bigint,meetings_booked bigint,callbacks_requested bigint,followups_scheduled bigint)
language sql stable security invoker set search_path='' as $$
select
 count(*) filter(where kind='call_attempt'),
 count(distinct subject_id) filter(where kind='call_attempt'),
 count(*) filter(where kind='call_attempt' and outcome='no_answer'),
 count(*) filter(where kind='call_attempt' and outcome='voicemail'),
 count(distinct subject_id) filter(where kind='call_attempt' and outcome='interested'),
 count(*) filter(where kind='meeting_scheduled'),
 count(*) filter(where kind='call_attempt' and outcome='callback_requested'),
 count(*) filter(where kind in ('followup_scheduled','meeting_scheduled'))
from public.activity_events
where owner_id=(select auth.uid()) and occurred_at >= (p_day::timestamp at time zone 'UTC') and occurred_at < ((p_day+1)::timestamp at time zone 'UTC')
$$;

-- Execute privileges default to PUBLIC in PostgreSQL; close all new functions explicitly.
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.is_lead_suppressed(uuid) from public,anon,authenticated;
revoke all on function public.daily_activity(date) from public,anon,authenticated;
grant execute on function public.is_lead_suppressed(uuid),public.daily_activity(date) to authenticated;
