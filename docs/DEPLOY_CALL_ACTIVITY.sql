-- Run once in Supabase SQL Editor as postgres. Existing history is retained.
BEGIN;
alter type public.call_outcome add value if not exists 'whatsapp';

-- A confirmed manual outcome and any accompanying field edits form one change.
-- Existing call triggers supply the original timestamp, history fact and counters.
create function public.record_call_activity(p_lead uuid,p_expected timestamptz,p_request uuid,p_status public.lead_status,p_data jsonb default '{}',p_notes text default '',p_date date default null,p_time time default null,p_followup uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid;outcome public.call_outcome;begin
 if p_status is null or p_status::text not in('no_answer','voicemail','interested','not_interested','follow_up','meeting_booked','awaiting_callback','whatsapp') then raise exception 'Choose a call outcome';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>30000 or exists(select 1 from jsonb_object_keys(p_data) k where k not in('business_name','phone','website_url','country','location','notes')) then raise exception 'Invalid lead fields';end if;
 if exists(select 1 from jsonb_each(p_data) e where jsonb_typeof(e.value) not in('string','null')) then raise exception 'Lead fields must be text';end if;
 if octet_length(coalesce(p_notes,''))>16000 or octet_length(coalesce(p_data->>'notes',''))>16000 then raise exception 'Notes exceed 16 KB';end if;
 c=private.start_change(p_lead,p_expected,'attempt',p_request);
 if (select after_updated_at is not null from public.workflow_changes where id=c) then
  if not exists(select 1 from public.workflow_changes wc join public.call_attempts a on a.id=wc.attempt_id where wc.id=c and a.outcome::text=case when p_status='follow_up' then 'callback_requested' else p_status::text end) then raise exception 'This confirmation already recorded a different outcome. Reload before continuing.';end if;
  return c;
 end if;
 if exists(select 1 from public.leads where id=p_lead and archived_at is not null) or public.is_lead_suppressed(p_lead) then raise exception 'Do-not-call or archived lead: outreach is blocked';end if;
 if p_data<>'{}'::jsonb then
 update public.leads set business_name=coalesce(p_data->>'business_name',business_name),phone=case when p_data?'phone' then nullif(p_data->>'phone','') else phone end,
 website_url=case when p_data?'website_url' then nullif(p_data->>'website_url','') else website_url end,country=case when p_data?'country' then nullif(p_data->>'country','') else country end,
 location=case when p_data?'location' then nullif(p_data->>'location','') else location end,notes=coalesce(p_data->>'notes',notes) where id=p_lead;
 end if;
 if p_status='whatsapp' then update public.leads set whatsapp_status='Waiting for Reply',whatsapp_notes=coalesce(p_notes,''),whatsapp_last_interaction=p_date where id=p_lead;end if;
 outcome=(case when p_status='follow_up' then 'callback_requested' else p_status::text end)::public.call_outcome;
 -- start_change recognizes this unfinished request, retaining its original snapshot.
 perform public.record_call(p_lead,p_expected,p_request,outcome,coalesce(p_notes,''),p_date,p_time,p_followup);
 return c;
end $$;
revoke all on function public.record_call_activity(uuid,timestamptz,uuid,public.lead_status,jsonb,text,date,time,uuid) from public,anon;
grant execute on function public.record_call_activity(uuid,timestamptz,uuid,public.lead_status,jsonb,text,date,time,uuid) to authenticated;
notify pgrst,'reload schema';

INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('202611150034') ON CONFLICT DO NOTHING;
COMMIT;
SELECT 'Call activity update installed successfully' AS result;
