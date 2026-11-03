\set ON_ERROR_STOP on
begin;
create schema test_support;
grant usage on schema test_support to anon,authenticated;
create function test_support.ok(condition boolean,label text) returns void language plpgsql as $$
begin if condition is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function test_support.denied(statement text,expected text,label text) returns void language plpgsql as $$
declare caught boolean=false;
begin
  begin execute statement; exception when others then
    caught=true;
    if sqlstate<>expected then raise exception 'FAIL: % (expected %, got %: %)',label,expected,sqlstate,sqlerrm; end if;
  end;
  if not caught then raise exception 'FAIL: % (statement unexpectedly succeeded)',label; end if;
  raise notice 'PASS: %',label;
end $$;
grant execute on all functions in schema test_support to anon,authenticated;

insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002');
insert into public.lead_pages(id,owner_id,name) values
 ('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Pakistan'),
 ('a0000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','USA'),
 ('b0000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','Other account');
insert into public.imports(id,owner_id,page_id,file_name,total_rows) values
 ('c0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','first.csv',10);
insert into public.leads(id,owner_id,page_id,import_id,business_name,phone,google_maps_url,notes) values
 ('d0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','Same business','+923005550101','https://www.google.com/maps?cid=ABC','Preserve original notes'),
 ('d0000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001',null,'Same business','+923005550101','https://www.google.com/maps?cid=ABC','Other account');
select test_support.ok((select count(*)=11 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity),'RLS enabled on all eleven application tables');

set local role anon;
select test_support.denied('select * from public.leads','42501','Unauthenticated users cannot read leads');
select test_support.denied('select public.daily_activity(current_date)','42501','Unauthenticated users cannot read analytics');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select test_support.ok((select count(*)=1 from public.leads),'RLS isolates users when no owner filter is supplied');
select test_support.ok((select count(*)=2 from public.lead_pages),'Page ownership is isolated');
select test_support.ok((select count(*)=0 from public.leads where owner_id='20000000-0000-4000-8000-000000000002'),'Foreign-owner SELECT returns no records');
update public.leads set notes='Attack' where id='d0000000-0000-4000-8000-000000000002';
select test_support.denied($q$insert into public.leads(page_id,business_name) values('b0000000-0000-4000-8000-000000000001','Cross owner')$q$,'23503','Composite page FK blocks cross-owner attachment');
select test_support.denied($q$insert into public.leads(owner_id,page_id,business_name) values('20000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001','Forged')$q$,'42501','Caller cannot forge owner_id');
insert into public.leads(page_id,business_name,google_maps_url) values('a0000000-0000-4000-8000-000000000002','Different name','https://www.google.com/maps?cid=ABC');
select test_support.ok((select count(*)=1 from public.leads),'Exact Maps duplicate is skipped across pages');
insert into public.leads(page_id,business_name,phone,google_maps_url,notes) values
 ('a0000000-0000-4000-8000-000000000002','Ignored duplicate','different','https://www.google.com/maps?cid=ABC','Overwrite attempt') on conflict do nothing;
select test_support.ok((select notes='Preserve original notes' from public.leads where id='d0000000-0000-4000-8000-000000000001'),'Skipping a Maps duplicate preserves original notes');
insert into public.leads(page_id,business_name,phone,website_url) values
 ('a0000000-0000-4000-8000-000000000002','Same business','+923005550101','https://same.example'),
 ('a0000000-0000-4000-8000-000000000002','Same business','+923005550101','https://same.example');
select test_support.ok((select count(*)=3 from public.leads),'Matching names, phones, websites and NULL Maps URLs are allowed');
insert into public.leads(page_id,business_name,google_maps_url) values ('a0000000-0000-4000-8000-000000000002','Different URL case','https://www.google.com/maps?cid=abc');
select test_support.ok((select count(*)=4 from public.leads),'Different exact URL values are never normalized together');
select test_support.denied($q$update public.leads set google_maps_url='https://example.com' where id='d0000000-0000-4000-8000-000000000001'$q$,'42501','Original Maps URL cannot be overwritten through the client');
select test_support.denied($q$update public.leads set created_at=now() where id='d0000000-0000-4000-8000-000000000001'$q$,'42501','Lead timestamps are server-owned');
select test_support.denied($q$insert into public.call_attempts(lead_id,outcome) values('d0000000-0000-4000-8000-000000000002','no_answer')$q$,'23503','Attempt cannot reference another owner lead');
select test_support.denied($q$insert into public.followups(lead_id,scheduled_date) values('d0000000-0000-4000-8000-000000000002',current_date)$q$,'23503','Follow-up cannot reference another owner lead');
select test_support.denied($q$insert into public.call_attempts(lead_id,outcome,occurred_at) values('d0000000-0000-4000-8000-000000000001','no_answer','2000-01-01')$q$,'42501','Attempt timestamp cannot be spoofed');
insert into public.call_attempts(lead_id,outcome,request_id) values
 ('d0000000-0000-4000-8000-000000000001','no_answer','e0000000-0000-4000-8000-000000000001'),
 ('d0000000-0000-4000-8000-000000000001','voicemail','e0000000-0000-4000-8000-000000000002'),
 ('d0000000-0000-4000-8000-000000000001','no_answer','e0000000-0000-4000-8000-000000000003');
insert into public.call_attempts(lead_id,outcome,request_id) values ('d0000000-0000-4000-8000-000000000001','interested','e0000000-0000-4000-8000-000000000004');
select test_support.denied($q$insert into public.call_attempts(lead_id,outcome,request_id) values('d0000000-0000-4000-8000-000000000001','no_answer','e0000000-0000-4000-8000-000000000004')$q$,'23505','Attempt request id prevents retry double-counting');
select test_support.ok((select count(*)=4 from public.activity_events where kind='call_attempt'),'Each attempt creates exactly one event');
select test_support.denied('update public.call_attempts set outcome=''not_interested''','42501','Attempt history cannot be rewritten');
update public.leads set status='interested' where id='d0000000-0000-4000-8000-000000000001';
select test_support.ok((select total_attempts=4 and failed_attempts=3 and consecutive_failed_attempts=0 and latest_outcome='interested' from public.lead_attempt_summary where lead_id='d0000000-0000-4000-8000-000000000001'),'Lifetime failures and consecutive failures remain independent from lead status');
select test_support.ok((select archived_at is null and last_contacted_at is not null from public.leads where id='d0000000-0000-4000-8000-000000000001'),'Interested lead is not archived for having three previous failures');
insert into public.followups(lead_id,scheduled_date,scheduled_time,notes) values('d0000000-0000-4000-8000-000000000001','2026-11-09','12:45','Callback');
select test_support.ok((select scheduled_date='2026-11-09' and scheduled_time='12:45' from public.followups limit 1),'Follow-up date and time stored without timezone conversion');
insert into public.followups(lead_id,scheduled_date,kind) values('d0000000-0000-4000-8000-000000000001','2026-11-10','meeting');
select test_support.ok((select calls_made=4 and businesses_contacted=1 and unanswered_calls=2 and interested_prospects=1 and followups_scheduled=2 and meetings_booked=1 from public.daily_activity((now() at time zone 'UTC')::date)),'Daily UTC statistics count facts and unique meeting schedules, not current lead status');
insert into public.leads(page_id,business_name,google_maps_url,notes) values('a0000000-0000-4000-8000-000000000002','Malicious upsert','https://www.google.com/maps?cid=ABC','Overwrite notes')
on conflict (owner_id,google_maps_url) where google_maps_url is not null do update set notes=excluded.notes,status='not_interested';
select test_support.ok((select notes='Preserve original notes' and status='interested' and archived_at is null from public.leads where id='d0000000-0000-4000-8000-000000000001'),'Even an explicit Maps upsert cannot overwrite the original notes or status');
select test_support.ok((select count(*)=4 from public.call_attempts),'Duplicate upsert leaves original attempt history unchanged');
set local time zone 'America/New_York';
select test_support.ok((select calls_made=4 from public.daily_activity((now() at time zone 'UTC')::date)),'UTC analytics are independent from session timezone');
set local time zone 'UTC';
select test_support.denied('insert into public.activity_events(owner_id,subject_id,kind,source_id) values(auth.uid(),gen_random_uuid(),''followup_scheduled'',gen_random_uuid())','42501','Client cannot fabricate analytics events');
select test_support.denied('insert into public.operations(source,kind) values(''ai'',''import_undo'')','42501','No direct client or AI operation executor exists');
select test_support.denied('select * from private.suppression_keys','42501','Suppression HMAC keys are private');
update public.leads set status='not_interested' where id='d0000000-0000-4000-8000-000000000001';
select test_support.ok((select archived_at is not null and archive_reason='not_interested' and purge_after=rejected_at+interval '480 hours' from public.leads where id='d0000000-0000-4000-8000-000000000001'),'Rejection archives and schedules retention at exactly twenty days');
select test_support.ok(public.is_lead_suppressed('d0000000-0000-4000-8000-000000000001'),'Rejection writes a do-not-call record');
select test_support.ok(not public.is_lead_suppressed('d0000000-0000-4000-8000-000000000002'),'Suppression RPC cannot inspect another owner lead');
select test_support.denied('delete from public.outreach_suppressions','42501','Client cannot erase suppression history');
select test_support.denied('delete from public.leads','42501','Physical deletion requires a future controlled privileged operation');
reset role;
select test_support.ok((select notes='Other account' from public.leads where id='d0000000-0000-4000-8000-000000000002'),'Cross-owner UPDATE did not modify foreign data');
set local session_replication_role='replica';
select test_support.denied($q$insert into public.leads(owner_id,page_id,business_name,google_maps_url) values('10000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002','Unique index backup','https://www.google.com/maps?cid=ABC')$q$,'23505','Unique Maps index still protects identity independently of insert triggers');
set local session_replication_role='origin';
select test_support.denied($q$insert into public.leads(owner_id,page_id,import_id,business_name) values('10000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001','Wrong import page')$q$,'23503','Import provenance must match its owner AND page');
select test_support.denied('update public.call_attempts set notes=''Corrupt''','23514','Trusted maintenance also cannot rewrite attempts');
select test_support.denied($q$insert into public.operations(owner_id,source,kind,target_import_id) values('10000000-0000-4000-8000-000000000001','user','import_undo','c0000000-0000-4000-8000-000000000001')$q$,'23514','Import operation scope cannot omit its page ownership anchor');
insert into public.operations(id,owner_id,source,kind) values ('f0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','user','lead_update');
insert into public.operation_items(owner_id,operation_id,lead_id,before_data,after_data) values('10000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','{"notes":"Private undo data"}','{}');
-- Simulate Phase 4's privileged physical purge. No cleanup job is installed in Phase 2.
delete from public.leads where id='d0000000-0000-4000-8000-000000000001';
select test_support.ok((select count(*)=0 from public.call_attempts),'Purge removes detailed attempts and their notes');
select test_support.ok((select count(*)=0 from public.followups),'Purge removes detailed follow-ups');
select test_support.ok((select count(*)=0 from public.operation_items),'Purge removes PII from undo snapshots');
select test_support.ok((select count(*)=6 from public.activity_events where lead_id is null and attempt_id is null),'Purge preserves anonymous facts and clears foreign detail references');
select test_support.ok((select count(*)=2 from public.outreach_suppressions),'Do-not-call fingerprints survive physical purge');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select test_support.ok((select calls_made=4 and businesses_contacted=1 from public.daily_activity((now() at time zone 'UTC')::date)),'Daily counts survive deletion without double-counting');
insert into public.leads(page_id,business_name,phone) values ('a0000000-0000-4000-8000-000000000002','Imported again','+92 (300) 555-0101');
select test_support.ok((select public.is_lead_suppressed(id) from public.leads where business_name='Imported again'),'Phone suppression flags a new lead but does not delete or reject its import');
insert into public.leads(page_id,business_name,google_maps_url) values ('a0000000-0000-4000-8000-000000000002','Maps reimport after purge','https://www.google.com/maps?cid=ABC');
select test_support.ok((select public.is_lead_suppressed(id) from public.leads where business_name='Maps reimport after purge'),'Exact Maps suppression survives original detail deletion');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select test_support.ok((select count(*)=0 from public.activity_events),'Retained statistics remain owner-isolated');
select test_support.ok((select count(*)=0 from public.lead_attempt_summary),'Security-invoker attempt view remains owner-isolated');
select test_support.ok(not public.is_lead_suppressed('d0000000-0000-4000-8000-000000000002'),'Another account does not inherit phone or Maps suppression');
select test_support.ok((select count(*)=1 from public.leads),'Another account retained the same exact Maps URL throughout');
rollback;
