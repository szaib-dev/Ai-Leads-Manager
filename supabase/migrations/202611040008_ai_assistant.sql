-- Phase 6. Private staged plans; owner-scoped public RPCs, no AI-generated SQL.
alter table public.operations add column ai_action text;
alter table public.imports add unique(id,owner_id);
alter table public.leads drop constraint leads_import_id_page_id_owner_id_fkey;
alter table public.leads add foreign key(import_id,owner_id) references public.imports(id,owner_id) on delete restrict;
-- Import provenance stays immutable; the current collection may change independently.
create table private.ai_plans (
 operation_id uuid primary key references public.operations(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 command jsonb,
 action text not null check(action in('search','edit','append_notes','delete','archive','archive_exhausted','restore','move','undo_import','undo_operation')),
 expires_at timestamptz not null default(clock_timestamp()+interval '10 minutes'),
 undo_id uuid,
 import_id uuid
);
create table private.ai_targets (
 operation_id uuid not null references private.ai_plans(operation_id) on delete cascade,
 owner_id uuid not null,
 lead_id uuid not null,
 expected_updated_at timestamptz not null,
 change_id uuid references public.workflow_changes(id) on delete set null,
 primary key(operation_id,lead_id),
 foreign key(lead_id,owner_id) references public.leads(id,owner_id) on delete cascade
);
create index ai_targets_lead on private.ai_targets(owner_id,lead_id);
revoke all on private.ai_plans,private.ai_targets from public,anon,authenticated;
create function private.ai_proof(p_token text) returns void language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or p_token is null or not exists(select 1 from private.ai_runtime where singleton and server_token_hash=sha256(convert_to(p_token,'UTF8'))) then raise exception 'AI server authorization unavailable' using errcode='42501';end if;
end $$;
create function private.ai_condition(l public.leads,attempts integer,failed integer,c jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare v text;n integer;f text=c->>'field';op text=c->>'op';wanted text=c->>'value';begin
 if f in('attempts','failed_attempts') then n=case when f='attempts' then coalesce(attempts,0) else coalesce(failed,0) end;
  if wanted!~'^\d{1,5}$' or op not in('equals','gte','lte') then raise exception 'Invalid numeric filter';end if;
  return case op when 'equals' then n=wanted::int when 'gte' then n>=wanted::int else n<=wanted::int end;
 elsif f in('archived','deleted') then
  if op<>'equals' or wanted not in('true','false') then raise exception 'Invalid workflow filter';end if;
  return (case when f='archived' then l.archived_at is not null else l.deleted_at is not null end)=(wanted='true');
 end if;
 v=case f when 'name' then l.business_name when 'phone' then l.phone when 'website' then l.website_url when 'maps' then l.google_maps_url when 'country' then l.country when 'location' then l.location when 'notes' then l.notes when 'status' then l.status::text else null end;
 if f not in('name','phone','website','maps','country','location','notes','status') or op not in('missing','present','equals','contains') or length(wanted)>500 then raise exception 'Unsupported AI filter';end if;
 return case op when 'missing' then nullif(btrim(v),'') is null when 'present' then nullif(btrim(v),'') is not null when 'equals' then case when f='maps' then coalesce(v,'') collate "C"=wanted collate "C" else lower(coalesce(v,''))=lower(wanted) end when 'contains' then position(lower(wanted) in lower(coalesce(v,'')))>0 end;
end $$;
create function private.ai_matches(l public.leads,attempts integer,failed integer,f jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare g jsonb;c jsonb;outer_value boolean;group_value boolean;v boolean;begin
 if jsonb_typeof(f->'groups') is distinct from 'array' or jsonb_array_length(f->'groups')>4 or f->>'logic' not in('and','or') then raise exception 'Invalid filter groups';end if;
 if jsonb_array_length(f->'groups')=0 then return true;end if;
 outer_value=(f->>'logic'='and');
 for g in select value from jsonb_array_elements(f->'groups') loop
  if g->>'logic' not in('and','or') or jsonb_typeof(g->'conditions') is distinct from 'array' or jsonb_array_length(g->'conditions') not between 1 and 8 then raise exception 'Invalid conditions';end if;
  group_value=(g->>'logic'='and');
  for c in select value from jsonb_array_elements(g->'conditions') loop
   if c->>'field' is null or c->>'op' is null or c->>'value' is null then raise exception 'Incomplete condition';end if;
   v=private.ai_condition(l,attempts,failed,c);
   if g->>'logic'='and' then group_value=group_value and v;else group_value=group_value or v;end if;
  end loop;
  if f->>'logic'='and' then outer_value=outer_value and group_value;else outer_value=outer_value or group_value;end if;
 end loop;return outer_value;
end $$;
create function public.ai_context(p_page uuid default null,p_selected uuid[] default '{}',p_recent uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid=private.phase3_owner();result jsonb;begin
 if cardinality(p_selected)>10000 or (select count(distinct x) from unnest(p_selected)x)<>(select count(*) from public.leads where id=any(p_selected) and owner_id=u) then raise exception 'Selection is unavailable';end if;
 if p_page is not null and not exists(select 1 from public.lead_pages where id=p_page and owner_id=u and deleted_at is null) then raise exception 'Current page unavailable';end if;
 if p_recent is not null and not exists(select 1 from public.imports where id=p_recent and owner_id=u and status='completed') then p_recent=null;end if;
 select jsonb_build_object('pages',coalesce((select jsonb_agg(to_jsonb(p)) from(select id,left(name,100) name from public.lead_pages where owner_id=u and deleted_at is null order by created_at desc limit 100)p),'[]'),'currentPage',p_page,'selectedCount',cardinality(p_selected),'verifiedRecentImport',p_recent,'imports',coalesce((select jsonb_agg(to_jsonb(b)) from(select id,page_id,left(file_name,80) file_name,created_at,batch_sequence,status from public.imports where owner_id=u and (p_page is null or page_id=p_page) and status='completed' order by batch_sequence desc limit 8)b),'[]')) into result;return result;
end $$;
create function public.ai_assistant_state() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid=private.phase3_owner();begin
 return jsonb_build_object('mode',coalesce((select ai_permission_mode::text from public.workspace_preferences where owner_id=u),'strict'),'budget',public.ai_csv_status(),'history',coalesce((select jsonb_agg(to_jsonb(o)) from(select id,coalesce(ai_action,kind::text) ai_action,status,affected_count,created_at,undo_expires_at from public.operations where owner_id=u and source='ai' order by created_at desc,id desc limit 30)o),'[]'));
end $$;
create function public.ai_set_mode(p_mode public.permission_mode) returns void language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();begin
 if p_mode is null then raise exception 'Mode required';end if;
 insert into public.workspace_preferences(owner_id,ai_permission_mode) values(u,p_mode) on conflict(owner_id) do update set ai_permission_mode=excluded.ai_permission_mode;
end $$;
create function public.ai_plan_result(p_id uuid,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid=private.phase3_owner();o public.operations;p private.ai_plans;m text;rows jsonb;begin
 select * into o from public.operations where id=p_id and owner_id=u and source='ai';
 select * into p from private.ai_plans where operation_id=o.id and owner_id=u;
 if o.id is null or p.operation_id is null or p_offset<0 or p_offset>10000 then raise exception 'Operation unavailable';end if;
 select coalesce(ai_permission_mode::text,'strict') into m from public.workspace_preferences where owner_id=u;m=coalesce(m,'strict');
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from(select l.id,l.page_id,l.business_name,l.phone,l.country,l.status,lp.name page_name from private.ai_targets t join public.leads l on l.id=t.lead_id and l.owner_id=u join public.lead_pages lp on lp.id=l.page_id where t.operation_id=o.id order by l.business_name,l.id limit 20 offset p_offset)r;
 return jsonb_build_object('id',o.id,'action',p.action,'status',o.status,'mode',m,'count',o.affected_count,'requiresApproval',p.action<>'search' and (m='strict' or m='balanced' and p.action<>'append_notes'),'expiresAt',p.expires_at,'rows',rows,'page',p_offset/20+1,'totalPages',greatest(1,ceil(o.affected_count/20.0)),'changes',coalesce(p.command->'changes','{}'),'scope',jsonb_build_object('pageId',o.target_page_id,'importId',o.target_import_id,'destinationId',p.command->>'destinationId'),'summary',case when o.status='completed' then 'Database confirmed' when o.status='reverted' then 'Undo confirmed' else 'Review the exact matched records. The target set is frozen for 10 minutes.' end);
end $$;
create function public.ai_stage(p_request uuid,p_command jsonb,p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();op uuid;act text=p_command->>'action';pid uuid=nullif(p_command->>'pageId','')::uuid;bid uuid=nullif(p_command->>'importId','')::uuid;dest uuid=nullif(p_command->>'destinationId','')::uuid;prev uuid=nullif(p_command->>'previousId','')::uuid;undo_id uuid=nullif(p_command->>'undoId','')::uuid;ids uuid[];n integer;m public.permission_mode;changes jsonb=coalesce(p_command->'changes','{}');begin
 perform private.ai_proof(p_token);perform private.ai_expire_plans();perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 select id into op from public.operations where owner_id=u and request_id=p_request;if found then return public.ai_plan_result(op);end if;
 if p_request is null or act not in('search','edit','append_notes','delete','archive','archive_exhausted','restore','move','undo_import','undo_operation') or jsonb_typeof(p_command)<>'object' or exists(select 1 from jsonb_object_keys(p_command) k where k not in('action','pageId','importId','destinationId','previousId','undoId','selectedIds','filter','changes')) then raise exception 'Unsupported AI operation';end if;
 if jsonb_typeof(changes)<>'object' or exists(select 1 from jsonb_object_keys(changes) k where k not in('business_name','phone','website_url','country','location','notes','status','scheduled_date','scheduled_time')) or octet_length(changes::text)>16000 then raise exception 'Unsupported changes';end if;
 if act not in('edit','append_notes') and changes<>'{}' then raise exception 'Unexpected edits';end if;
 if act='append_notes' and (nullif(changes->>'notes','') is null or changes-'notes'<>'{}') then raise exception 'Append notes requires only notes';end if;
 if pid is not null and not exists(select 1 from public.lead_pages where id=pid and owner_id=u and deleted_at is null) then raise exception 'Page unavailable';end if;
 if bid is not null and not exists(select 1 from public.imports where id=bid and owner_id=u and status='completed' and (pid is null or page_id=pid)) then raise exception 'Import unavailable in this scope';end if;
 if act='move' and (dest is null or not exists(select 1 from public.lead_pages where id=dest and owner_id=u and deleted_at is null)) then raise exception 'Destination unavailable';end if;
 if prev is not null and not exists(select 1 from private.ai_plans where operation_id=prev and owner_id=u and action='search') then raise exception 'Previous results unavailable';end if;
 if jsonb_typeof(p_command->'selectedIds') is distinct from 'array' or jsonb_array_length(p_command->'selectedIds')>10000 then raise exception 'Invalid selection';end if;
 select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(p_command->'selectedIds');
 if cardinality(ids)>0 and (select count(distinct x) from unnest(ids)x)<>(select count(*) from public.leads where owner_id=u and id=any(ids)) then raise exception 'Selected records unavailable';end if;
 if act='undo_import' and bid is null then raise exception 'Import required';end if;
 if act='undo_operation' and not exists(select 1 from public.operations where id=undo_id and owner_id=u and source='ai' and status='completed' and undo_expires_at>clock_timestamp() and ai_action in('edit','append_notes','delete','archive','archive_exhausted','restore','move')) then raise exception 'No eligible AI operation to undo';end if;
 select coalesce(ai_permission_mode,'strict') into m from public.workspace_preferences where owner_id=u;m=coalesce(m,'strict');
 insert into public.operations(owner_id,request_id,source,kind,permission_mode,target_page_id,target_import_id,ai_action)
 values(u,p_request,'ai',case when act='undo_import' then 'import_undo'::public.operation_kind when act='delete' then 'lead_delete_matching'::public.operation_kind else 'lead_update'::public.operation_kind end,m,coalesce(pid,(select page_id from public.imports where id=bid)),bid,act) returning id into op;
 insert into private.ai_plans(operation_id,owner_id,command,action,undo_id,import_id) values(op,u,p_command,act,undo_id,bid);
 if act='undo_operation' then
 insert into private.ai_targets(operation_id,owner_id,lead_id,expected_updated_at) select op,u,t.lead_id,l.updated_at from private.ai_targets t join public.leads l on l.id=t.lead_id where t.operation_id=undo_id and t.owner_id=u;
 if (select count(*) from private.ai_targets where operation_id=op)<>(select affected_count from public.operations where id=undo_id) then raise exception 'Some records expired; undo is unavailable';end if;
 elsif act='undo_import' then
 insert into private.ai_targets(operation_id,owner_id,lead_id,expected_updated_at) select op,u,l.id,l.updated_at from public.import_members im join public.leads l on l.id=im.lead_id where im.import_id=bid and im.owner_id=u;
 else
 insert into private.ai_targets(operation_id,owner_id,lead_id,expected_updated_at)
 select op,u,l.id,l.updated_at from public.leads l join public.lead_pages lp on lp.id=l.page_id and lp.owner_id=u left join public.lead_attempt_summary a on a.lead_id=l.id and a.owner_id=u
 where l.owner_id=u and lp.deleted_at is null and (pid is null or l.page_id=pid) and (bid is null or l.import_id=bid)
 and (cardinality(ids)=0 or l.id=any(ids)) and (prev is null or exists(select 1 from private.ai_targets t where t.operation_id=prev and t.lead_id=l.id and t.owner_id=u))
 and (case when act='restore' then l.deleted_at is not null or l.archived_at is not null else l.deleted_at is null end)
 and (act<>'archive_exhausted' or (l.status in('no_answer','voicemail') and l.archived_at is null and coalesce(a.consecutive_failed_attempts,0)>=3))
 and private.ai_matches(l,coalesce(a.total_attempts,0),coalesce(a.consecutive_failed_attempts,0),p_command->'filter')
 order by l.id limit 10001;
 end if;
 get diagnostics n=row_count;
 select count(*) into n from private.ai_targets where operation_id=op;
 if n>10000 then raise exception 'More than 10,000 matches. Narrow the scope.';end if;
 update public.operations set affected_count=n,status=case when act='search' then 'completed'::public.operation_status else 'planned'::public.operation_status end,finished_at=case when act='search' then clock_timestamp() end where id=op;
 if act='search' then update private.ai_plans set command=null where operation_id=op;end if;
 return public.ai_plan_result(op);
end $$;
create function public.ai_execute(p_id uuid,p_approved boolean,p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();o public.operations;p private.ai_plans;m text;t record;l public.leads;c uuid;changes jsonb;act text;target_before jsonb;begin
 perform private.ai_proof(p_token);perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 select * into o from public.operations where id=p_id and owner_id=u and source='ai' for update;
 select * into p from private.ai_plans where operation_id=o.id and owner_id=u for update;
 if o.id is null or p.operation_id is null then raise exception 'Operation unavailable';end if;
 if o.status in('completed','reverted') then return public.ai_plan_result(o.id);end if;
 if o.status<>'planned' or p.expires_at<clock_timestamp() or p.command is null then raise exception 'Plan expired or cancelled. Ask again for a fresh preview.';end if;
 select ai_permission_mode::text into m from public.workspace_preferences where owner_id=u;m=coalesce(m,'strict');act=p.action;
 if (m='strict' or m='balanced' and act<>'append_notes') and p_approved is distinct from true then raise exception 'Explicit approval required';end if;
 if (select count(*) from private.ai_targets where operation_id=o.id)<>o.affected_count or exists(select 1 from private.ai_targets target join public.leads current_lead on current_lead.id=target.lead_id where target.operation_id=o.id and (current_lead.owner_id<>u or current_lead.updated_at<>target.expected_updated_at or not exists(select 1 from public.lead_pages lp where lp.id=current_lead.page_id and lp.owner_id=u and lp.deleted_at is null))) then raise exception 'Records changed after preview. Request a fresh plan.';end if;
 perform 1 from public.leads where id in(select lead_id from private.ai_targets where operation_id=o.id) order by id for update;
 update public.operations set status='executing',permission_mode=m::public.permission_mode where id=o.id;
 if act='undo_import' then
  perform public.undo_import(p.import_id);
 elsif act='undo_operation' then
  if not exists(select 1 from public.operations where id=p.undo_id and owner_id=u and source='ai' and status='completed' and undo_expires_at>clock_timestamp()) or (select count(*) from private.ai_targets where operation_id=p.undo_id and change_id in(select id from public.workflow_changes where undone_at is null))<>o.affected_count then raise exception 'Undo is no longer available';end if;
  for t in select at.change_id from private.ai_targets at join public.workflow_changes w on w.id=at.change_id where at.operation_id=p.undo_id and at.owner_id=u order by w.sequence desc loop perform public.undo_workflow(t.change_id);end loop;
  update public.operations set status='reverted' where id=p.undo_id;
 else
  changes=coalesce(p.command->'changes','{}');
  if act in('append_notes','delete','archive','archive_exhausted','restore','move') or act='edit' and not (changes?'status' or changes?'scheduled_date' or changes?'scheduled_time') then
   perform private.ai_bulk_apply(o.id,p.command);
  else
  for t in select * from private.ai_targets where operation_id=o.id order by lead_id loop
   select * into strict l from public.leads where id=t.lead_id and owner_id=u;
   if (act='restore' or changes?'phone' or changes?'status' and changes->>'status'<>'not_interested') and (l.status='not_interested' or public.is_lead_suppressed(l.id)) then raise exception 'AI cannot remove do-not-call protection. Correct a mistaken rejection explicitly through history.';end if;
   if act='move' then
    if not exists(select 1 from public.lead_pages where id=(p.command->>'destinationId')::uuid and owner_id=u and deleted_at is null) then raise exception 'Destination unavailable';end if;
    c=private.start_change(l.id,l.updated_at,'lead_edit',gen_random_uuid());
    update public.leads set page_id=(p.command->>'destinationId')::uuid where id=l.id and owner_id=u;perform private.finish_change(c);
   elsif act='restore' and l.deleted_at is not null then
    insert into public.workflow_changes(owner_id,lead_id,request_id,kind,before_data,before_followups) values(u,l.id,gen_random_uuid(),'restore',to_jsonb(l),'[]') returning id into c;
    perform set_config('folio.change_id',c::text,true);
    update public.leads set deleted_at=null where id=l.id and owner_id=u;perform private.route_lead(l.id,'new');perform private.finish_change(c);
   else
    if act='append_notes' then changes=jsonb_build_object('notes',case when l.notes='' then p.command#>>'{changes,notes}' else l.notes||E'\n'||(p.command#>>'{changes,notes}') end);end if;
    if act='archive_exhausted' then
     if l.status not in('no_answer','voicemail') or not exists(select 1 from public.lead_attempt_summary where lead_id=l.id and owner_id=u and consecutive_failed_attempts>=3) then raise exception 'Lead no longer meets unsuccessful-attempt rule';end if;
     c=private.start_change(l.id,l.updated_at,'archive',gen_random_uuid());update public.leads set archived_at=clock_timestamp(),archive_reason='attempts_exhausted' where id=l.id;update public.followups set cancelled_at=clock_timestamp() where lead_id=l.id and completed_at is null and cancelled_at is null;perform private.finish_change(c);
    else
     perform public.save_lead(l.id,l.updated_at,case when act in('edit','append_notes') then changes else '{}'::jsonb end,case when act in('edit','append_notes') then 'edit' else act end);
     select id into c from public.workflow_changes where lead_id=l.id and owner_id=u and undone_at is null order by sequence desc limit 1;
    end if;
   end if;
   update private.ai_targets set change_id=c where operation_id=o.id and lead_id=l.id;
  end loop;
  end if;
 end if;
 update public.operations set status='completed',finished_at=clock_timestamp() where id=o.id;
 update private.ai_plans set command=null where operation_id=o.id;
 return public.ai_plan_result(o.id);
end $$;
create function public.ai_cancel(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();begin
 update public.operations set status='failed',finished_at=clock_timestamp() where id=p_id and owner_id=u and source='ai' and status='planned';
 update private.ai_plans set command=null where operation_id=p_id and owner_id=u and exists(select 1 from public.operations where id=p_id and status='failed');
end $$;
create function private.ai_expire_plans() returns void language plpgsql security definer set search_path='' as $$begin
 update public.operations o set status='failed',finished_at=clock_timestamp() from private.ai_plans p where p.operation_id=o.id and o.status='planned' and p.expires_at<clock_timestamp();
 update private.ai_plans set command=null where expires_at<clock_timestamp();
 delete from private.ai_plans p using public.operations o where o.id=p.operation_id and o.undo_expires_at<clock_timestamp();
end $$;
create function private.ai_purge_privacy() returns trigger language plpgsql security definer set search_path='' as $$begin
 update private.ai_plans p set command=null from public.operations o where o.id=p.operation_id and p.owner_id=old.owner_id and o.status='planned';
 update public.operations set status='failed',finished_at=clock_timestamp() where owner_id=old.owner_id and source='ai' and status='planned';
 return old;
end $$;
create trigger ai_purge_privacy before delete on public.leads for each row execute function private.ai_purge_privacy();
revoke all on function private.ai_proof(text),private.ai_condition(public.leads,integer,integer,jsonb),private.ai_matches(public.leads,integer,integer,jsonb),private.ai_expire_plans(),private.ai_purge_privacy() from public,anon,authenticated;
revoke all on function public.ai_context(uuid,uuid[],uuid),public.ai_assistant_state(),public.ai_set_mode(public.permission_mode),public.ai_plan_result(uuid,integer),public.ai_stage(uuid,jsonb,text),public.ai_execute(uuid,boolean,text),public.ai_cancel(uuid) from public,anon;
grant execute on function public.ai_context(uuid,uuid[],uuid),public.ai_assistant_state(),public.ai_set_mode(public.permission_mode),public.ai_plan_result(uuid,integer),public.ai_stage(uuid,jsonb,text),public.ai_execute(uuid,boolean,text),public.ai_cancel(uuid) to authenticated;
do $$begin if exists(select 1 from pg_extension where extname='pg_cron') then perform cron.schedule('folio-ai-plan-expiry','*/10 * * * *','select private.ai_expire_plans()');end if;end $$;

-- Workflow correction also restores collection membership and safe import baselines.
create or replace function public.undo_workflow(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
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
 update public.leads set page_id=(b->>'page_id')::uuid,business_name=b->>'business_name',phone=b->>'phone',website_url=b->>'website_url',country=b->>'country',location=b->>'location',notes=b->>'notes',status=(b->>'status')::public.lead_status,last_contacted_at=(b->>'last_contacted_at')::timestamptz,archived_at=(b->>'archived_at')::timestamptz,archive_reason=(b->>'archive_reason')::public.archive_reason,rejected_at=(b->>'rejected_at')::timestamptz,purge_after=(b->>'purge_after')::timestamptz,deleted_at=(b->>'deleted_at')::timestamptz,rejection_source=(b->>'rejection_source')::uuid where id=c.lead_id and owner_id=u;
 perform set_config('folio.undo_id','',true);
 update public.import_members im set expected_updated_at=(select updated_at from public.leads where id=c.lead_id),expected_deleted_at=(b->>'deleted_at')::timestamptz where im.lead_id=c.lead_id and im.owner_id=u and im.expected_updated_at=(b->>'updated_at')::timestamptz and im.expected_deleted_at is not distinct from (b->>'deleted_at')::timestamptz;

 update public.workflow_changes set undone_at=clock_timestamp() where id=c.id;
 insert into public.activity_events(owner_id,subject_id,lead_id,kind,source_id) values(u,l.subject_id,l.id,'change_reverted',c.id);
 -- Permit sequential corrections without losing timestamp conflict protection.
 select id into latest from public.workflow_changes where lead_id=c.lead_id and owner_id=u and undone_at is null order by sequence desc limit 1;
 if latest is not null then
  update public.workflow_changes w set after_updated_at=(select updated_at from public.leads where id=c.lead_id),after_followups=coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.followups t where t.lead_id=c.lead_id and t.owner_id=u and (t.created_by_change=w.id or t.id in(select (x->>'id')::uuid from jsonb_array_elements(w.before_followups)x))),'[]') where w.id=latest;
 end if;
end $$;


create trigger workspace_signal after insert or update or delete on public.workspace_preferences for each row execute function private.signal_workspace_change();
-- Batch ordinary modifications without a network request or PL/pgSQL call per lead.
alter table public.workflow_changes add column ai_operation_id uuid references public.operations(id) on delete set null;
create index workflow_ai_operation on public.workflow_changes(ai_operation_id,lead_id) where ai_operation_id is not null;
create or replace function private.current_change(p_lead uuid) returns uuid language sql stable security definer set search_path='' as $$
 select id from public.workflow_changes where lead_id=p_lead and owner_id=auth.uid() and after_updated_at is null and undone_at is null and (id=nullif(current_setting('folio.change_id',true),'')::uuid or ai_operation_id=nullif(current_setting('folio.ai_operation',true),'')::uuid) limit 1
$$;
create function private.ai_bulk_apply(p_operation uuid,p_command jsonb) returns void language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();act text=p_command->>'action';ch jsonb=coalesce(p_command->'changes','{}');begin
 if (act='restore' or ch?'phone') and exists(select 1 from private.ai_targets t join public.leads l on l.id=t.lead_id where t.operation_id=p_operation and (l.status='not_interested' or public.is_lead_suppressed(l.id))) then raise exception 'AI cannot remove do-not-call protection. Correct a mistaken rejection explicitly through history.';end if;
 if act='move' and not exists(select 1 from public.lead_pages where id=(p_command->>'destinationId')::uuid and owner_id=u and deleted_at is null) then raise exception 'Destination unavailable';end if;
 if act='archive_exhausted' and exists(select 1 from private.ai_targets t join public.leads l on l.id=t.lead_id left join public.lead_attempt_summary a on a.lead_id=l.id and a.owner_id=u where t.operation_id=p_operation and (l.status not in('no_answer','voicemail') or coalesce(a.consecutive_failed_attempts,0)<3)) then raise exception 'Lead no longer meets unsuccessful-attempt rule';end if;
 insert into public.workflow_changes(owner_id,lead_id,request_id,kind,before_data,before_followups,ai_operation_id)
 select u,l.id,gen_random_uuid(),case when act in('append_notes','edit','move') then 'lead_edit' when act='archive_exhausted' then 'archive' else act end,to_jsonb(l),coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.followups f where f.lead_id=l.id and f.owner_id=u and f.completed_at is null and f.cancelled_at is null),'[]'),p_operation
 from private.ai_targets t join public.leads l on l.id=t.lead_id where t.operation_id=p_operation and t.owner_id=u;
 perform set_config('folio.ai_operation',p_operation::text,true);
 if act in('edit','append_notes') then
  update public.leads l set
   business_name=coalesce(ch->>'business_name',l.business_name),
   phone=case when ch?'phone' then nullif(ch->>'phone','') else l.phone end,
   website_url=case when ch?'website_url' then nullif(ch->>'website_url','') else l.website_url end,
   country=case when ch?'country' then nullif(ch->>'country','') else l.country end,
   location=case when ch?'location' then nullif(ch->>'location','') else l.location end,
   notes=case when act='append_notes' then case when l.notes='' then ch->>'notes' else l.notes||E'\n'||(ch->>'notes') end else coalesce(ch->>'notes',l.notes) end
  from private.ai_targets t where t.operation_id=p_operation and l.id=t.lead_id and l.owner_id=u;
 elsif act='delete' then update public.leads l set deleted_at=clock_timestamp() from private.ai_targets t where t.operation_id=p_operation and l.id=t.lead_id and l.owner_id=u;
 elsif act in('archive','archive_exhausted') then update public.leads l set archived_at=clock_timestamp(),archive_reason=case when act='archive' then 'manual'::public.archive_reason else 'attempts_exhausted'::public.archive_reason end from private.ai_targets t where t.operation_id=p_operation and l.id=t.lead_id and l.owner_id=u;
 elsif act='move' then update public.leads l set page_id=(p_command->>'destinationId')::uuid from private.ai_targets t where t.operation_id=p_operation and l.id=t.lead_id and l.owner_id=u;
 elsif act='restore' then update public.leads l set deleted_at=null,status='new',archived_at=null,archive_reason=null,rejected_at=null,purge_after=null from private.ai_targets t where t.operation_id=p_operation and l.id=t.lead_id and l.owner_id=u;
 else raise exception 'Unsupported batch action';end if;
 if act in('delete','archive','archive_exhausted','restore') then update public.followups f set cancelled_at=clock_timestamp() from private.ai_targets t where t.operation_id=p_operation and f.lead_id=t.lead_id and f.owner_id=u and f.completed_at is null and f.cancelled_at is null;end if;
 update public.workflow_changes c set after_updated_at=l.updated_at,after_followups=coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.followups f where f.lead_id=c.lead_id and f.owner_id=u and f.id in(select (b->>'id')::uuid from jsonb_array_elements(c.before_followups)b)),'[]') from public.leads l where c.ai_operation_id=p_operation and c.lead_id=l.id and c.owner_id=u;
 update private.ai_targets t set change_id=c.id from public.workflow_changes c where t.operation_id=p_operation and c.ai_operation_id=p_operation and t.lead_id=c.lead_id and t.owner_id=u;
 perform set_config('folio.ai_operation','',true);
end $$;
revoke all on function private.ai_bulk_apply(uuid,jsonb) from public,anon,authenticated;
alter function public.ai_execute(uuid,boolean,text) set statement_timeout='60s';
alter function public.ai_stage(uuid,jsonb,text) set statement_timeout='30s';
notify pgrst,'reload config';
