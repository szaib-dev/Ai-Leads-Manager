-- Reject date-only plans instead of confirming an edit that cannot create a schedule.
create or replace function public.ai_stage(p_request uuid,p_command jsonb,p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();op uuid;act text=p_command->>'action';pid uuid=nullif(p_command->>'pageId','')::uuid;bid uuid=nullif(p_command->>'importId','')::uuid;dest uuid=nullif(p_command->>'destinationId','')::uuid;prev uuid=nullif(p_command->>'previousId','')::uuid;undo_id uuid=nullif(p_command->>'undoId','')::uuid;ids uuid[];n integer;m public.permission_mode;changes jsonb=coalesce(p_command->'changes','{}');begin
 perform private.ai_proof(p_token);perform private.ai_expire_plans();perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 select id into op from public.operations where owner_id=u and request_id=p_request;if found then return public.ai_plan_result(op);end if;
 if p_request is null or act not in('search','edit','append_notes','delete','archive','archive_exhausted','restore','move','undo_import','undo_operation') or jsonb_typeof(p_command)<>'object' or exists(select 1 from jsonb_object_keys(p_command) k where k not in('action','pageId','importId','destinationId','previousId','undoId','selectedIds','filter','changes')) then raise exception 'Unsupported AI operation';end if;
 if jsonb_typeof(changes)<>'object' or exists(select 1 from jsonb_object_keys(changes) k where k not in('business_name','phone','website_url','country','location','notes','status','scheduled_date','scheduled_time')) or octet_length(changes::text)>16000 then raise exception 'Unsupported changes';end if;
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

alter function public.ai_stage(uuid,jsonb,text) set statement_timeout='30s';
