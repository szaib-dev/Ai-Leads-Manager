-- Only remove leading spreadsheet apostrophes from dialable numbers.
create function private.strip_phone_apostrophes(p_phone text) returns text
language sql immutable strict set search_path='' as $$
 select case when cleaned <> p_phone
   and regexp_replace(cleaned,'[[:space:]().-]','','g') ~ '^[+]?[0-9]{7,15}$'
   then cleaned end
 from (select regexp_replace(p_phone,$re$^[[:space:]]*['‘’]+$re$,'') cleaned) s
$$;
revoke all on function private.strip_phone_apostrophes(text) from public,anon,authenticated;

create or replace function public.ai_context(p_page uuid default null,p_selected uuid[] default '{}',p_recent uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid=private.phase3_owner();result jsonb;begin
 if cardinality(p_selected)>10000 or (select count(distinct x) from unnest(p_selected)x)<>(select count(*) from public.leads where id=any(p_selected) and owner_id=u) then raise exception 'Selection is unavailable';end if;
 if p_page is not null and not exists(select 1 from public.lead_pages where id=p_page and owner_id=u and deleted_at is null) then raise exception 'Current page unavailable';end if;
 if p_recent is not null and not exists(select 1 from public.imports where id=p_recent and owner_id=u and status='completed') then p_recent=null;end if;
 select jsonb_build_object('pages',coalesce((select jsonb_agg(to_jsonb(p)) from(select lp.id,left(lp.name,100) name,c.name country from public.lead_pages lp left join public.lead_countries c on c.id=lp.country_id and c.owner_id=u where lp.owner_id=u and lp.deleted_at is null order by lp.created_at desc limit 100)p),'[]'),'currentPage',p_page,'selectedCount',cardinality(p_selected),'verifiedRecentImport',p_recent,'imports',coalesce((select jsonb_agg(to_jsonb(b)) from(select id,page_id,left(file_name,80) file_name,created_at,batch_sequence,status from public.imports where owner_id=u and (p_page is null or page_id=p_page) and status='completed' order by batch_sequence desc limit 8)b),'[]')) into result;return result;
end $$;

create or replace function public.ai_stage(p_request uuid,p_command jsonb,p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();op uuid;act text=p_command->>'action';pid uuid=nullif(p_command->>'pageId','')::uuid;bid uuid=nullif(p_command->>'importId','')::uuid;dest uuid=nullif(p_command->>'destinationId','')::uuid;prev uuid=nullif(p_command->>'previousId','')::uuid;undo_id uuid=nullif(p_command->>'undoId','')::uuid;ids uuid[];n integer;m public.permission_mode;changes jsonb=coalesce(p_command->'changes','{}');begin
 perform private.ai_proof(p_token);perform private.ai_expire_plans();perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 select id into op from public.operations where owner_id=u and request_id=p_request;if found then return public.ai_plan_result(op);end if;
 if p_request is null or act not in('search','edit','append_notes','delete','archive','archive_exhausted','restore','move','undo_import','undo_operation') or jsonb_typeof(p_command)<>'object' or exists(select 1 from jsonb_object_keys(p_command) k where k not in('action','pageId','importId','destinationId','previousId','undoId','selectedIds','filter','changes')) then raise exception 'Unsupported AI operation';end if;
 if jsonb_typeof(changes)<>'object' or exists(select 1 from jsonb_object_keys(changes) k where k not in('business_name','phone','phone_cleanup','website_url','country','location','notes','status','scheduled_date','scheduled_time')) or octet_length(changes::text)>16000 then raise exception 'Unsupported changes';end if;
 if changes?'phone_cleanup' and (act<>'edit' or changes<>'{"phone_cleanup":"strip_leading_apostrophes"}'::jsonb) then raise exception 'Invalid phone cleanup';end if;
 if act not in('edit','append_notes') and changes<>'{}' then raise exception 'Unexpected edits';end if;
 if act='edit' and changes='{}' then raise exception 'No changes specified';end if;
 if (changes?'scheduled_date' and coalesce(changes->>'status','') not in('follow_up','meeting_booked')) or (changes?'scheduled_time' and not changes?'scheduled_date') or (changes->>'status' in('follow_up','meeting_booked') and nullif(changes->>'scheduled_date','') is null) then raise exception 'Scheduling requires a follow-up or meeting status and an explicit date';end if;
 if act='append_notes' and (nullif(changes->>'notes','') is null or changes-'notes'<>'{}') then raise exception 'Append notes requires only notes';end if;
 if pid is not null and not exists(select 1 from public.lead_pages where id=pid and owner_id=u and deleted_at is null) then raise exception 'Page unavailable';end if;
 if bid is not null and not exists(select 1 from public.imports where id=bid and owner_id=u and status='completed' and (pid is null or page_id=pid)) then raise exception 'Import unavailable in this scope';end if;
 if act='move' and (dest is null or not exists(select 1 from public.lead_pages where id=dest and owner_id=u and deleted_at is null)) then raise exception 'Destination unavailable';end if;
 if prev is not null and not exists(select 1 from private.ai_plans where operation_id=prev and owner_id=u and action='search') then raise exception 'Previous results unavailable';end if;
 if jsonb_typeof(p_command->'selectedIds') is distinct from 'array' or jsonb_array_length(p_command->'selectedIds')>10000 then raise exception 'Invalid selection';end if;
 select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(p_command->'selectedIds');
 if cardinality(ids)>0 and (select count(distinct x) from unnest(ids)x)<>(select count(*) from public.leads where owner_id=u and id=any(ids)) then raise exception 'Selected records unavailable';end if;
 if changes?'phone_cleanup' and pid is null and bid is null and prev is null and cardinality(ids)=0 then raise exception 'Choose a page, selection, or import for phone cleanup';end if;
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
 and (not changes?'phone_cleanup' or (l.archived_at is null and l.status<>'not_interested'
      and private.strip_phone_apostrophes(l.phone) is not null and not public.is_lead_suppressed(l.id)))
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

alter function public.ai_stage(uuid,jsonb,text) set statement_timeout='30s';

create or replace function private.ai_bulk_apply(p_operation uuid,p_command jsonb) returns void language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();act text=p_command->>'action';ch jsonb=coalesce(p_command->'changes','{}');begin
 -- ai_execute has locked the targets. Recheck cleanup eligibility and the frozen version under that lock.
 if ch?'phone_cleanup' and exists(
  select 1 from private.ai_targets t join public.leads l on l.id=t.lead_id and l.owner_id=u
  where t.operation_id=p_operation and (l.updated_at<>t.expected_updated_at
   or l.deleted_at is not null or l.archived_at is not null or l.status='not_interested'
   or private.strip_phone_apostrophes(l.phone) is null or public.is_lead_suppressed(l.id))
 ) then raise exception 'Phone cleanup records changed after preview. Request a fresh plan.';end if;
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
   phone=case when ch?'phone_cleanup' then private.strip_phone_apostrophes(l.phone) when ch?'phone' then nullif(ch->>'phone','') else l.phone end,
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
