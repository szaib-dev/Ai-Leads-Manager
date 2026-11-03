-- Dedicated project only. Existing confirmed user ownership; all fixtures rolled back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email_confirmed_at is not null order by created_at limit 1),true);
-- Trusted fixture facts; app callers cannot fabricate events or override timestamps.
insert into public.lead_pages(id,owner_id,name)values('a8000000-0000-4000-8000-000000000008',auth.uid(),'Analytics Pakistan fixture'),('a8000000-0000-4000-8000-000000000009',auth.uid(),'Analytics Canada fixture');
insert into public.leads(id,owner_id,page_id,business_name)values('b8000000-0000-4000-8000-000000000008',auth.uid(),'a8000000-0000-4000-8000-000000000008','Private business to purge'),('b8000000-0000-4000-8000-000000000009',auth.uid(),'a8000000-0000-4000-8000-000000000009','Second fixture');
insert into public.activity_events(owner_id,subject_id,lead_id,kind,source_id,outcome,occurred_at,attempt_number)
select auth.uid(),l.subject_id,l.id,'call_attempt',gen_random_uuid(),x.outcome::public.call_outcome,x.stamp::timestamptz,x.n
from(values('b8000000-0000-4000-8000-000000000008','no_answer','2026-11-02T18:59:59Z',1),('b8000000-0000-4000-8000-000000000008','interested','2026-11-02T19:00:00Z',2),('b8000000-0000-4000-8000-000000000009','voicemail','2026-11-03T18:59:59Z',1),('b8000000-0000-4000-8000-000000000009','not_interested','2026-11-03T19:00:00Z',2))x(lead,outcome,stamp,n) join public.leads l on l.id=x.lead::uuid;
set local role authenticated;
do $$declare r jsonb;v bigint;v_lead uuid;stamp timestamptz;c uuid;begin
 r=public.analytics_report('2026-11-03','2026-11-03','Asia/Karachi','a8000000-0000-4000-8000-000000000008');
 if (r#>>'{summary,attempts}')::int<>1 or (r#>>'{summary,answered}')::int<>1 or (r#>>'{summary,voicemails}')::int<>0 or (r#>>'{summary,interested}')::int<>1 or (r#>>'{summary,conversion_rate}')::numeric<>100 then raise exception 'Karachi midnight or analytics calculation failed: %',r->'summary';end if;
 if (public.analytics_report('2026-11-03','2026-11-03','Asia/Karachi','a8000000-0000-4000-8000-000000000008')#>>'{summary,attempts}')::int<>1 then raise exception 'Page analytics failed';end if;
 r=public.analytics_report('2026-03-08','2026-03-08','America/New_York');if (r->>'end_at')::timestamptz-(r->>'start_at')::timestamptz<>interval '23 hours' then raise exception 'Spring DST boundary wrong';end if;
 r=public.analytics_report('2026-11-01','2026-11-01','America/New_York');if (r->>'end_at')::timestamptz-(r->>'start_at')::timestamptz<>interval '25 hours' then raise exception 'Fall DST boundary wrong';end if;
 raise notice 'PASS: Karachi midnight, exclusive end boundary, DST 23/25-hour days, page scope and conversion math';
 select updated_at into stamp from public.leads where id='b8000000-0000-4000-8000-000000000008';
 perform public.save_lead('b8000000-0000-4000-8000-000000000008',stamp,'{"status":"no_answer"}');
 if (public.analytics_report('2026-11-03','2026-11-03','Asia/Karachi','a8000000-0000-4000-8000-000000000008')#>>'{summary,interested}')::int<>1 then raise exception 'Current status rewrote history';end if;
 begin perform public.analytics_report('2026-11-04','2026-11-03');raise exception 'Reverse date range accepted';exception when raise_exception then if sqlerrm='Reverse date range accepted' then raise;end if;end;
 begin perform public.analytics_report('2026-11-03','2026-11-03','Fake/Timezone');raise exception 'Invalid zone accepted';exception when raise_exception then if sqlerrm='Invalid zone accepted' then raise;end if;end;
 r=public.analytics_report('2000-01-01','2000-01-01');if (r#>>'{summary,answer_rate}')::numeric<>0 or (r#>>'{summary,conversion_rate}')::numeric<>0 then raise exception 'Zero denominators wrong';end if;
 raise notice 'PASS: Status changes preserve historical outcomes, invalid ranges/zones rejected, zero rates safe';
 -- Frozen numbers survive undo; a corrected attempt is retained but not counted twice.
 insert into public.leads(page_id,business_name)values('a8000000-0000-4000-8000-000000000008','Numbered calls')returning leads.id,updated_at into v_lead,stamp;
 c=public.record_call(v_lead,stamp,gen_random_uuid(),'no_answer','Exact note');perform public.undo_workflow(c);select updated_at into stamp from public.leads where leads.id=v_lead;
 c=public.record_call(v_lead,stamp,gen_random_uuid(),'interested','Confirmed after correction');
 if not exists(select 1 from public.call_attempts where lead_id=v_lead and attempt_number=2 and voided_at is null) or (select total_attempts from public.lead_attempt_summary where lead_id=v_lead)<>1 then raise exception 'Attempt numbers renumbered after correction';end if;
 if not exists(select 1 from jsonb_array_elements(public.activity_range((now() at time zone 'Asia/Karachi')::date,(now() at time zone 'Asia/Karachi')::date)->'rows')x where x->>'notes'='Confirmed after correction' and (x->>'attempt_number')::int=2) then raise exception 'Activity lost exact notes or ordinal';end if;
 select revision into v from public.workspace_sync where owner_id=auth.uid();
 perform public.manage_page(null,'Bulk signal fixture','',false);perform public.save_lead(v_lead,(select updated_at from public.leads where leads.id=v_lead),'{"notes":"Another change"}');
 if (select revision from public.workspace_sync where owner_id=auth.uid())<>v then raise exception 'More than one signal in one transaction';end if;
 begin update public.workspace_sync set revision=0 where owner_id=auth.uid();raise exception 'Client forged sync revision';exception when insufficient_privilege then null;end;
 raise notice 'PASS: Immutable attempt ordinals, retained corrections, accurate notes and one signal per transaction';
 perform set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000009',true);
 if exists(select 1 from public.workspace_sync) then raise exception 'Cross-owner sync read';end if;
 begin perform public.analytics_report('2026-11-03','2026-11-03','UTC','a8000000-0000-4000-8000-000000000008');raise exception 'Cross-owner page analytics';exception when insufficient_privilege then null;end;
 if (public.analytics_report('2026-11-03','2026-11-03')#>>'{summary,attempts}')::int<>0 then raise exception 'Cross-owner counts exposed';end if;
 raise notice 'PASS: RLS protects sync checkpoints, historical aggregates and page attribution';
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email_confirmed_at is not null order by created_at limit 1),true);
select set_config('test.analytics_summary',(public.analytics_report('2026-11-03','2026-11-03','Asia/Karachi','a8000000-0000-4000-8000-000000000008')->'summary')::text,true);
delete from public.leads where id='b8000000-0000-4000-8000-000000000008';
do $$declare r jsonb;begin
 r=public.analytics_report('2026-11-03','2026-11-03','Asia/Karachi','a8000000-0000-4000-8000-000000000008');
 if r->'summary'<>current_setting('test.analytics_summary')::jsonb then raise exception 'Retained page statistics lost after purge';end if;
 r=public.activity_range('2026-11-03','2026-11-03','Asia/Karachi','a8000000-0000-4000-8000-000000000008');
 if exists(select 1 from jsonb_array_elements(r->'rows')x where x->>'business_name'='Private business to purge') then raise exception 'Deleted PII retained in activity';end if;
 if not exists(select 1 from jsonb_array_elements(r->'rows')x where x->>'business_name'='Removed business' and (x->>'attempt_number')::int=2) then raise exception 'Anonymous history or ordinal lost';end if;
 if exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename<>'workspace_sync') or exists(select 1 from pg_publication where pubname='supabase_realtime' and pubdelete) then raise exception 'Unsafe business or DELETE publication';end if;
 raise notice 'PASS: Retention preserves anonymous page statistics/ordinals, removes business details, and publishes no PII';
end $$;
select json_build_object('analytics_checks','passed','fixtures','transaction rollback') as verification;
rollback;
