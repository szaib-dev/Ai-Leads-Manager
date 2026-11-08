begin;
insert into auth.users(id) values('94000000-0000-4000-8000-000000000008');
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000008',true);
update private.ai_runtime set server_token_hash=sha256(convert_to('fixture-server-proof','UTF8')),pricing_verified=current_date;
create function pg_temp.command(action text,page uuid,changes jsonb default '{}') returns jsonb language sql as $$select jsonb_build_object('action',action,'pageId',page,'importId',null,'selectedIds','[]'::jsonb,'previousId',null,'undoId',null,'filter','{"logic":"and","groups":[]}'::jsonb,'changes',changes,'destinationId',null)$$;
set local role authenticated;
do $$declare p uuid;l uuid;l2 uuid;stamp timestamptz;r jsonb;op uuid;cmd jsonb;begin
 p=public.manage_page(null,'AI safety fixture','',false);perform public.ai_set_mode('autonomous');
 begin perform public.ai_stage(gen_random_uuid(),pg_temp.command('edit',p,jsonb_build_object('scheduled_date',(current_date+3)::text)),'fixture-server-proof');raise exception 'Date-only schedule accepted';exception when raise_exception then if sqlerrm<>'Scheduling requires a follow-up or meeting status and an explicit date' then raise;end if;end;

 insert into public.leads(page_id,business_name,phone) values(p,'Sensitive purged fixture','+12025550123') returning id,updated_at into l,stamp;
 perform public.record_call(l,stamp,gen_random_uuid(),'interested','Sensitive calling note');
 insert into public.leads(page_id,business_name,phone) values(p,'Second safe fixture','+12025550124') returning id into l2;
 r=public.ai_stage(gen_random_uuid(),pg_temp.command('edit',p,'{"status":"interested"}'),'fixture-server-proof');perform public.ai_execute((r->>'id')::uuid,false,'fixture-server-proof');
 if (public.analytics_report(current_date,current_date,'UTC',p)#>>'{summary,attempts}')::int<>1 then raise exception 'AI fabricated calls';end if;
 r=public.ai_stage(gen_random_uuid(),pg_temp.command('edit',p,jsonb_build_object('status','follow_up','scheduled_date',(current_date+3)::text)),'fixture-server-proof');op=(r->>'id')::uuid;perform public.ai_execute(op,false,'fixture-server-proof');
 if (select count(*) from public.followups where owner_id=auth.uid() and completed_at is null and cancelled_at is null)<>2 then raise exception 'AI schedule missing';end if;
 r=public.ai_stage(gen_random_uuid(),pg_temp.command('undo_operation',null)||jsonb_build_object('undoId',op),'fixture-server-proof');perform public.ai_execute((r->>'id')::uuid,false,'fixture-server-proof');
 if exists(select 1 from public.followups where owner_id=auth.uid() and completed_at is null and cancelled_at is null) or exists(select 1 from public.leads where page_id=p and status<>'interested') then raise exception 'Schedule correction failed';end if;
 r=public.ai_stage(gen_random_uuid(),pg_temp.command('edit',p,'{"status":"not_interested"}')||jsonb_build_object('selectedIds',jsonb_build_array(l)),'fixture-server-proof');op=(r->>'id')::uuid;perform public.ai_execute(op,false,'fixture-server-proof');if not public.is_lead_suppressed(l) then raise exception 'AI rejection failed to protect outreach';end if;
 r=public.ai_stage(gen_random_uuid(),pg_temp.command('undo_operation',null)||jsonb_build_object('undoId',op),'fixture-server-proof');perform public.ai_execute((r->>'id')::uuid,false,'fixture-server-proof');if public.is_lead_suppressed(l) then raise exception 'Explicit AI correction did not reverse its own rejection';end if;
 raise notice 'PASS: AI status/follow-up routing, exact schedule undo, no fabricated calls, reversible rejection with DNC protection';
 r=public.ai_stage(gen_random_uuid(),pg_temp.command('delete',p)||jsonb_build_object('selectedIds',jsonb_build_array(l2)),'fixture-server-proof');op=(r->>'id')::uuid;perform public.ai_execute(op,false,'fixture-server-proof');
 r=public.ai_stage(gen_random_uuid(),pg_temp.command('restore',p)||jsonb_build_object('selectedIds',jsonb_build_array(l2)),'fixture-server-proof');op=(r->>'id')::uuid;perform public.ai_execute(op,false,'fixture-server-proof');if (select deleted_at from public.leads where id=l2) is not null then raise exception 'Explicit restore failed';end if;
 r=public.ai_stage(gen_random_uuid(),pg_temp.command('undo_operation',null)||jsonb_build_object('undoId',op),'fixture-server-proof');perform public.ai_execute((r->>'id')::uuid,false,'fixture-server-proof');if (select deleted_at from public.leads where id=l2) is null then raise exception 'Restore undo lost prior deletion';end if;
 r=public.ai_stage(gen_random_uuid(),pg_temp.command('append_notes',p,jsonb_build_object('notes','Fresh note')),'fixture-server-proof');perform set_config('test.expiring_plan',r->>'id',true);
 perform set_config('test.purge_lead',l::text,true);perform set_config('test.safety_page',p::text,true);
 raise notice 'PASS: explicit soft-deleted restore and undo preserve correct workflow';
end $$;
do $$
declare
 p uuid:=public.manage_page(null,'Phone cleanup fixture','',false);
 other uuid:=public.manage_page(null,'Out of scope fixture','',false);
 l uuid;
 blocked uuid;
 stamp timestamptz;
 original text:=chr(39)||'+1 (306) 555-0100';
 patch jsonb:='{"phone_cleanup":"strip_leading_apostrophes"}';
 cmd jsonb;
 result jsonb;
 op uuid;
begin
 insert into public.leads(page_id,business_name,phone) values
  (p,'Malformed',original) returning id into l;
 insert into public.leads(page_id,business_name,phone) values
  (p,'Already clean','+13065550101'),
  (p,'Invalid',chr(39)||'abc'),
  (other,'Another page',original);
 insert into public.leads(page_id,business_name,phone) values
  (p,'Rejected',chr(39)||'+13065550102') returning id,updated_at into blocked,stamp;
 perform public.record_call(blocked,stamp,gen_random_uuid(),'not_interested','');

 begin
  perform public.ai_stage(gen_random_uuid(),pg_temp.command('edit',null,patch),'fixture-server-proof');
  raise exception 'Unscoped cleanup accepted';
 exception when raise_exception then
  if sqlerrm not like 'Choose a page, selection, or import%' then raise;end if;
 end;

 perform public.ai_set_mode('strict');
 cmd=pg_temp.command('edit',p,patch);
 result=public.ai_stage(gen_random_uuid(),cmd,'fixture-server-proof');
 op=(result->>'id')::uuid;
 if result->>'count'<>'1' or result->>'requiresApproval'<>'true' then raise exception 'Incorrect cleanup preview';end if;
 begin
  perform public.ai_execute(op,false,'fixture-server-proof');
  raise exception 'Unapproved cleanup executed';
 exception when raise_exception then
  if sqlerrm<>'Explicit approval required' then raise;end if;
 end;
 perform public.ai_execute(op,true,'fixture-server-proof');
 if (select phone from public.leads where id=l) is distinct from '+1 (306) 555-0100'
  or (select phone from public.leads where id=blocked) is distinct from chr(39)||'+13065550102'
  or (select phone from public.leads where page_id=other) is distinct from original
 then raise exception 'Cleanup changed an ineligible number or lost dialable formatting';end if;

 result=public.ai_stage(gen_random_uuid(),pg_temp.command('undo_operation',null)||jsonb_build_object('undoId',op),'fixture-server-proof');
 perform public.ai_execute((result->>'id')::uuid,true,'fixture-server-proof');
 if (select phone from public.leads where id=l) is distinct from original then raise exception 'Cleanup undo failed';end if;
 raise notice 'PASS: scoped phone cleanup, approval, rejected lead exclusion, and undo';
end $$;
reset role;
update private.ai_plans set expires_at=clock_timestamp()-interval '1 minute' where operation_id=current_setting('test.expiring_plan')::uuid;
select private.ai_expire_plans();
set local role authenticated;
do $$declare r jsonb;begin
 begin perform public.ai_execute(current_setting('test.expiring_plan')::uuid,false,'fixture-server-proof');raise exception 'Expired plan executed';exception when raise_exception then if sqlerrm not like 'Plan expired or cancelled%' then raise;end if;end;
 r=public.ai_stage(gen_random_uuid(),pg_temp.command('edit',current_setting('test.safety_page')::uuid,'{"notes":"Sensitive staged text"}'),'fixture-server-proof');
end $$;
reset role;
delete from public.leads where id=current_setting('test.purge_lead')::uuid;
do $$begin
 if exists(select 1 from private.ai_plans where owner_id='94000000-0000-4000-8000-000000000008' and command is not null) then raise exception 'Purged details remain in staged plans';end if;
 if exists(select 1 from public.workflow_changes where owner_id='94000000-0000-4000-8000-000000000008' and before_data->>'business_name'='Sensitive purged fixture') then raise exception 'Purged AI snapshot retained';end if;
 if exists(select 1 from public.operations o where owner_id='94000000-0000-4000-8000-000000000008' and to_jsonb(o)::text like '%Sensitive%') then raise exception 'AI history retains business details';end if;
 if (public.analytics_report(current_date,current_date,'UTC',current_setting('test.safety_page')::uuid)#>>'{summary,attempts}')::int<>1 then raise exception 'AI detail purge lost anonymous history';end if;
 raise notice 'PASS: expiry blocks execution; physical purge clears staged PII and AI snapshots while retaining anonymous call statistics';
end $$;
rollback;
