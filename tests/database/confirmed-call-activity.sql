begin;
insert into auth.users(id)values('99000000-0000-4000-8000-000000000034'),('98000000-0000-4000-8000-000000000034');
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000034',true);
set local role authenticated;
do $$declare page uuid;lead uuid;stamp timestamptz;c uuid;r uuid;s text;n integer;history jsonb;begin
 page=public.manage_page(null,'All call outcomes','',false);
 foreach s in array array['no_answer','voicemail','interested','not_interested','follow_up','meeting_booked','awaiting_callback','whatsapp'] loop
  insert into public.leads(page_id,business_name,phone)values(page,'Outcome '||s,gen_random_uuid()::text) returning id,updated_at into lead,stamp;
  r=gen_random_uuid();c=public.record_call_activity(lead,stamp,r,s::public.lead_status,jsonb_build_object('business_name','Confirmed '||s),'Confirmed outcome note',current_date+7,'14:30');
  if (select count(*) from public.call_attempts where lead_id=lead and voided_at is null)<>1 then raise exception 'Uncounted outcome: %',s;end if;
  if not exists(select 1 from public.call_attempts where lead_id=lead and occurred_at between transaction_timestamp() and clock_timestamp()) then raise exception 'Missing original call timestamp: %',s;end if;
  if not exists(select 1 from public.activity_events where lead_id=lead and kind='call_attempt' and occurred_at::date=current_date) then raise exception 'Call fact missing for %',s;end if;
  if not exists(select 1 from public.leads where id=lead and last_contacted_at is not null and business_name='Confirmed '||s and status::text=s) then raise exception 'Metadata/status/contact date not saved: %',s;end if;
  if (select total_attempts from public.lead_attempt_summary where lead_id=lead)<>1 then raise exception 'Counter missing: %',s;end if;
  perform public.record_call_activity(lead,stamp,r,s::public.lead_status,'{}','retry',current_date+7,'14:30');
  if (select count(*) from public.call_attempts where lead_id=lead)<>1 then raise exception 'Retry duplicated %',s;end if;
  begin perform public.record_call_activity(lead,stamp,r,case when s='interested' then 'no_answer'::public.lead_status else 'interested'::public.lead_status end);raise exception 'BAD changed retry';exception when raise_exception then if sqlerrm='BAD changed retry' then raise;end if;end;
 end loop;
 if (public.calling_history_range(current_date,current_date,'UTC')->>'total')::int<>8 then raise exception 'All outcomes missing from history';end if;
 if (public.analytics_report(current_date,current_date,'UTC')->'summary'->>'attempts')::int<>8 then raise exception 'Daily attempt totals differ';end if;
 -- Undo reverses the single combined edit and attempt, preserving a corrected history row.
 perform public.undo_workflow(c);
 if (select total_attempts from public.lead_attempt_summary where lead_id=lead) is not null then
  if (select total_attempts from public.lead_attempt_summary where lead_id=lead)<>0 then raise exception 'Undo retained counted attempt';end if;
 end if;
 if not exists(select 1 from public.leads where id=lead and status='new' and business_name='Outcome whatsapp') then raise exception 'Undo lost original fields';end if;
 insert into public.leads(page_id,business_name)values(page,'Metadata only') returning id,updated_at into lead,stamp;
 perform public.save_lead(lead,stamp,'{"notes":"Only a note"}');
 if exists(select 1 from public.call_attempts where lead_id=lead) then raise exception 'Metadata fabricated an attempt';end if;
 select updated_at into stamp from public.leads where id=lead;
 begin perform public.record_call_activity(lead,stamp,gen_random_uuid(),'follow_up','{"business_name":"Should roll back"}');raise exception 'BAD missing schedule';exception when raise_exception then if sqlerrm='BAD missing schedule' then raise;end if;end;
 if not exists(select 1 from public.leads where id=lead and business_name='Metadata only') or exists(select 1 from public.call_attempts where lead_id=lead) then raise exception 'Failed call was not atomic';end if;
 perform set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000034',true);
 begin perform public.record_call_activity(lead,stamp,gen_random_uuid(),'interested');raise exception 'BAD foreign lead';exception when insufficient_privilege then null;end;
 raise notice 'PASS: eight dated outcomes, atomic edits, counters, idempotency, undo, schedule failure and owner isolation';
end $$;
rollback;
