-- Run only against the explicitly selected Phase 2 project after migration.
-- Uses a confirmed account's ownership context; all fixture writes roll back.
begin;
set local statement_timeout='20s';
create temporary table verification_results(label text primary key) on commit drop;
grant select,insert on verification_results to authenticated,anon;
select set_config('folio.test.owner', (select id::text from auth.users where email_confirmed_at is not null order by created_at desc limit 1),true);
do $$ begin if nullif(current_setting('folio.test.owner'),'') is null then raise exception 'No confirmed account exists'; end if; end $$;
select set_config('request.jwt.claim.sub',current_setting('folio.test.owner'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('folio.test.owner'),'role','authenticated')::text,true);
insert into verification_results values('Confirmed personal account exists');
do $$ begin
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity)<>11 then raise exception 'RLS not enabled on all application tables';end if;
end $$;
insert into verification_results values('All eleven application tables have RLS');
set local role authenticated;
do $$ declare p1 uuid;p2 uuid;lead uuid;other_lead uuid;rows_affected integer;before_calls bigint;after_calls bigint;request uuid=gen_random_uuid();begin
 insert into public.lead_pages(name) values('Phase 2 remote security check - rollback') returning id into p1;
 insert into public.lead_pages(name) values('Phase 2 cross-page check - rollback') returning id into p2;
 insert into verification_results values('Authenticated owner can create and read a page');
 insert into public.leads(page_id,business_name,phone,google_maps_url,notes) values(p1,'Phase 2 fixture','+12025550199','https://www.google.com/maps?folio_security_test='||p1::text,'Original notes') returning id into lead;
 insert into public.leads(page_id,business_name,phone) values(p2,'Phase 2 fixture','+12025550199') returning id into other_lead;
 insert into public.leads(page_id,business_name,phone) values(p2,'Phase 2 fixture','+12025550199');
 insert into verification_results values('Matching phone/name and absent Maps URL do not block creation');
 insert into public.leads(page_id,business_name,google_maps_url,notes) values(p2,'Duplicate attempt','https://www.google.com/maps?folio_security_test='||p1::text,'Overwrite')
 on conflict(owner_id,google_maps_url) where google_maps_url is not null do update set notes=excluded.notes,status='not_interested';
 get diagnostics rows_affected=row_count;
 if rows_affected<>0 or not exists(select 1 from public.leads where id=lead and notes='Original notes' and status='new') then raise exception 'Duplicate upsert changed original';end if;
 insert into verification_results values('Cross-page exact Maps upsert skips duplicate and preserves original');
 begin update public.leads set owner_id=gen_random_uuid() where id=lead;raise exception 'Ownership update allowed';exception when insufficient_privilege then null;end;
 insert into verification_results values('Client cannot change record ownership');
 begin insert into public.call_attempts(lead_id,outcome,occurred_at) values(lead,'no_answer','2000-01-01');raise exception 'Timestamp spoof allowed';exception when insufficient_privilege then null;end;
 insert into verification_results values('Client cannot supply attempt timestamps');
 select calls_made into before_calls from public.daily_activity((now() at time zone 'UTC')::date);
 insert into public.call_attempts(lead_id,outcome,request_id) values(lead,'no_answer',request);
 begin insert into public.call_attempts(lead_id,outcome,request_id) values(lead,'no_answer',request);raise exception 'Idempotency failed';exception when unique_violation then null;end;
 select calls_made into after_calls from public.daily_activity((now() at time zone 'UTC')::date);
 if after_calls<>before_calls+1 then raise exception 'Attempt double counted';end if;
 insert into verification_results values('One attempt produces one retained fact; retry request ID is rejected');
 begin update public.call_attempts set outcome='interested' where lead_id=lead;raise exception 'Attempt history writable';exception when insufficient_privilege then null;end;
 insert into verification_results values('Attempt history cannot be rewritten');
 insert into public.followups(lead_id,scheduled_date,scheduled_time) values(lead,'2026-11-09','12:45');
 if not exists(select 1 from public.followups where lead_id=lead and scheduled_date='2026-11-09' and scheduled_time='12:45') then raise exception 'Schedule changed';end if;
 insert into verification_results values('Follow-up preserves literal date and time');
 update public.leads set status='not_interested' where id=lead;
 if not exists(select 1 from public.leads where id=lead and archived_at is not null and purge_after=rejected_at+interval '480 hours') then raise exception 'Retention fields wrong';end if;
 if not public.is_lead_suppressed(other_lead) then raise exception 'Phone suppression failed';end if;
 insert into verification_results values('Rejection archives for twenty days and flags same-phone outreach without deleting leads');
 begin delete from public.leads where id=lead;raise exception 'Client deletion allowed';exception when insufficient_privilege then null;end;
 insert into verification_results values('Authenticated client cannot physically delete leads');
 begin insert into public.operations(source,kind) values('ai','import_undo');raise exception 'AI writes allowed';exception when insufficient_privilege then null;end;
 insert into verification_results values('Clients cannot fabricate controlled-operation audit records');
 perform set_config('folio.test.lead',lead::text,true);
 perform set_config('folio.test.page',p1::text,true);
 perform set_config('folio.test.calls',after_calls::text,true);
end $$;
reset role;
-- Different authenticated identity: zero access to the actual owner's fixture.
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.leads where id=current_setting('folio.test.lead')::uuid) then raise exception 'Cross-user SELECT exposed lead';end if;
 update public.leads set notes='Unauthorized' where id=current_setting('folio.test.lead')::uuid;
 if found then raise exception 'Cross-user update modified lead';end if;
 begin insert into public.leads(page_id,business_name) values(current_setting('folio.test.page')::uuid,'Foreign owner');raise exception 'Cross-user page insert accepted';exception when foreign_key_violation then null;end;
 if exists(select 1 from public.activity_events) then raise exception 'Cross-user facts exposed';end if;
 if public.is_lead_suppressed(current_setting('folio.test.lead')::uuid) then raise exception 'Suppression leaked';end if;
end $$;
insert into verification_results values('Different authenticated identity cannot read/update owner leads or attach to owner page'),('Analytics and suppression lookup remain owner-isolated');
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.leads limit 1;raise exception 'Anonymous lead read allowed';exception when insufficient_privilege then null;end;
 begin perform public.daily_activity(current_date);raise exception 'Anonymous analytics allowed';exception when insufficient_privilege then null;end;
end $$;
insert into verification_results values('Anonymous role cannot read leads or analytics');
reset role;
-- Simulate a privileged future retention purge, on this transaction-only fixture.
delete from public.leads where id=current_setting('folio.test.lead')::uuid;
select set_config('request.jwt.claim.sub',current_setting('folio.test.owner'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('folio.test.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if (select calls_made from public.daily_activity((now() at time zone 'UTC')::date))<>current_setting('folio.test.calls')::bigint then raise exception 'Purge erased statistics';end if;
 if exists(select 1 from public.call_attempts where lead_id=current_setting('folio.test.lead')::uuid) then raise exception 'Attempt detail retained';end if;
end $$;
insert into verification_results values('Physical purge removes private detail while retained daily counts survive');
reset role;
select json_build_object('passed',count(*),'checks',json_agg(label order by label)) as verification from verification_results;
rollback;
