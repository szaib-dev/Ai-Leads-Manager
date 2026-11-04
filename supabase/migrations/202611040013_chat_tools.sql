-- Chat artifacts contain validated references, never executable UI or uploaded CSV contents.
alter table public.ai_chat_messages add column artifact jsonb check(artifact is null or (jsonb_typeof(artifact)='object' and octet_length(artifact::text)<=64000));

create function public.delete_ai_conversation(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();begin
 perform 1 from public.ai_conversations where id=p_id and owner_id=u for update;
 if not found then raise exception 'Conversation unavailable' using errcode='42501';end if;
 if exists(select 1 from public.ai_chat_messages where conversation_id=p_id and owner_id=u and status='processing' and lease_until>clock_timestamp()) then raise exception 'Wait for this conversation to finish before deleting it';end if;
 -- Unexecuted previews belonging to the deleted chat cannot be approved later.
 update public.operations set status='failed',finished_at=clock_timestamp() where owner_id=u and status='planned' and id in(select operation_id from public.ai_chat_messages where conversation_id=p_id and owner_id=u);
 update private.ai_plans set command=null where owner_id=u and operation_id in(select operation_id from public.ai_chat_messages where conversation_id=p_id and owner_id=u) and operation_id in(select id from public.operations where owner_id=u and status='failed');
 delete from public.ai_conversations where id=p_id and owner_id=u;
end $$;

create function public.record_chat_import(p_conversation uuid,p_user uuid,p_assistant uuid,p_import uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();b public.imports%rowtype;begin
 if p_conversation is null or p_user is null or p_assistant is null or p_user=p_assistant then raise exception 'Invalid attachment identifiers';end if;
 select * into b from public.imports where id=p_import and owner_id=u;
 if not found then raise exception 'Import unavailable' using errcode='42501';end if;
 insert into public.ai_conversations(id,owner_id,title,scope_page_id) values(p_conversation,u,left('Import '||b.file_name,100),b.page_id) on conflict(id) do nothing;
 perform 1 from public.ai_conversations where id=p_conversation and owner_id=u for update;
 if not found then raise exception 'Conversation unavailable' using errcode='42501';end if;
 if exists(select 1 from public.ai_chat_messages where id in(p_user,p_assistant) and (owner_id<>u or conversation_id<>p_conversation or (id=p_user and role<>'user') or (id=p_assistant and (role<>'assistant' or artifact->>'importId' is distinct from p_import::text)))) then raise exception 'Attachment identifiers already used';end if;
 insert into public.ai_chat_messages(id,owner_id,conversation_id,role,content,status) values(p_user,u,p_conversation,'user','CSV attachment: '||left(b.file_name,255),'completed') on conflict(id) do nothing;
 insert into public.ai_chat_messages(id,owner_id,conversation_id,role,content,status,reply_to,artifact)
 values(p_assistant,u,p_conversation,'assistant',format('%s leads imported. %s exact Maps duplicates skipped; %s invalid rows.',b.successful_rows,b.skipped_duplicates,b.invalid_rows),'completed',p_user,jsonb_build_object('kind','import','importId',b.id,'pageId',b.page_id,'fileName',b.file_name,'imported',b.successful_rows,'duplicates',b.skipped_duplicates,'invalid',b.invalid_rows,'status',b.status)) on conflict(id) do nothing;
 update public.ai_conversations set updated_at=clock_timestamp() where id=p_conversation and owner_id=u;
end $$;

create function public.undo_chat_import(p_conversation uuid,p_import uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();begin
 if not exists(select 1 from public.ai_chat_messages where owner_id=u and conversation_id=p_conversation and artifact->>'importId'=p_import::text) then raise exception 'Import is not attached to this conversation' using errcode='42501';end if;
 perform public.undo_import(p_import);
 update public.ai_chat_messages set artifact=jsonb_set(artifact,'{status}','"undone"') where owner_id=u and conversation_id=p_conversation and artifact->>'importId'=p_import::text;
end $$;

-- Explicit checkbox deletions work without an AI provider. Each item uses the existing
-- audited workflow and optimistic concurrency guard; a failure rolls back the whole batch.
create table private.selection_deletions(owner_id uuid not null references auth.users(id) on delete cascade,request_id uuid not null,items jsonb not null,changes uuid[] not null,undone boolean not null default false,primary key(owner_id,request_id));
revoke all on private.selection_deletions from public,anon,authenticated;
create function public.delete_lead_selection(p_request uuid,p_items jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();prior private.selection_deletions%rowtype;r jsonb;ids uuid[]='{}';changes uuid[]='{}';c uuid;begin
 if p_request is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'Select between 1 and 200 leads';end if;
 perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 select * into prior from private.selection_deletions where owner_id=u and request_id=p_request;
 if found then if prior.items<>p_items then raise exception 'Deletion retry does not match its preview';end if;return jsonb_array_length(prior.items);end if;
 for r in select value from jsonb_array_elements(p_items) order by value->>'id' loop
  if jsonb_typeof(r)<>'object' or exists(select 1 from jsonb_object_keys(r) k where k not in('id','expected')) or (r->>'id')::uuid=any(ids) then raise exception 'Invalid selection';end if;
  ids=array_append(ids,(r->>'id')::uuid);
  perform public.save_lead((r->>'id')::uuid,(r->>'expected')::timestamptz,'{}','delete');
  select id into c from public.workflow_changes where lead_id=(r->>'id')::uuid and owner_id=u order by sequence desc limit 1;
  changes=array_append(changes,c);
 end loop;
 insert into private.selection_deletions(owner_id,request_id,items,changes) values(u,p_request,p_items,changes);
 return cardinality(ids);
end $$;
create function public.undo_lead_selection(p_request uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();b private.selection_deletions%rowtype;c uuid;begin
 perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 select * into b from private.selection_deletions where owner_id=u and request_id=p_request for update;
 if not found then raise exception 'Deletion unavailable' using errcode='42501';end if;if b.undone then return;end if;
 foreach c in array b.changes loop perform public.undo_workflow(c);end loop;
 update private.selection_deletions set undone=true where owner_id=u and request_id=p_request;
end $$;

create table private.ai_relevance(operation_id uuid primary key references public.operations(id) on delete cascade,owner_id uuid not null references auth.users(id) on delete cascade,analysis jsonb not null);
create index ai_relevance_owner on private.ai_relevance(owner_id);
revoke all on private.ai_relevance from public,anon,authenticated;
create function public.save_ai_relevance(p_id uuid,p_analysis jsonb,p_token text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();r jsonb;begin
 perform private.ai_proof(p_token);
 if not exists(select 1 from public.operations where id=p_id and owner_id=u and ai_action='search' and source='ai') or jsonb_typeof(p_analysis) is distinct from 'object' or octet_length(p_analysis::text)>32000 or jsonb_typeof(p_analysis->'items') is distinct from 'array' or jsonb_array_length(p_analysis->'items')>10 then raise exception 'Invalid analysis';end if;
 for r in select value from jsonb_array_elements(p_analysis->'items') loop
  if r->>'classification' not in('relevant','irrelevant','uncertain') or not exists(select 1 from private.ai_targets t join public.leads l on l.id=t.lead_id and l.owner_id=u where t.owner_id=u and t.operation_id=p_id and t.lead_id=(r->>'id')::uuid and l.updated_at=(r->>'expected')::timestamptz and l.deleted_at is null) then raise exception 'Analysis record changed or is unavailable';end if;
 end loop;
 insert into private.ai_relevance values(p_id,u,p_analysis) on conflict(operation_id) do update set analysis=excluded.analysis where private.ai_relevance.owner_id=u;
end $$;
alter function public.ai_plan_result(uuid,integer) rename to ai_plan_result_evidence;
revoke all on function public.ai_plan_result_evidence(uuid,integer) from public,anon,authenticated;
create function public.ai_plan_result(p_id uuid,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid=private.phase3_owner();r jsonb;a jsonb;begin
 r=public.ai_plan_result_evidence(p_id,p_offset);
 select analysis into a from private.ai_relevance where operation_id=p_id and owner_id=u;
 return r||case when a is null then '{}'::jsonb else jsonb_build_object('analysis',a) end;
end $$;

-- Permanently removed lead information must also disappear from derived evidence.
create function private.clear_chat_evidence() returns trigger language plpgsql security definer set search_path='' as $$begin
 delete from private.ai_relevance where owner_id=old.owner_id;
 update public.ai_chat_messages set artifact=null where owner_id=old.owner_id and artifact is not null;
 return old;
end $$;
create trigger clear_chat_evidence after delete on public.leads for each row execute function private.clear_chat_evidence();
create trigger workspace_signal after insert or update or delete on public.ai_conversations for each row execute function private.signal_workspace_change();
revoke all on function private.clear_chat_evidence() from public,anon,authenticated;
revoke all on function public.delete_ai_conversation(uuid),public.record_chat_import(uuid,uuid,uuid,uuid),public.undo_chat_import(uuid,uuid),public.delete_lead_selection(uuid,jsonb),public.undo_lead_selection(uuid),public.save_ai_relevance(uuid,jsonb,text),public.ai_plan_result(uuid,integer) from public,anon;
grant execute on function public.delete_ai_conversation(uuid),public.record_chat_import(uuid,uuid,uuid,uuid),public.undo_chat_import(uuid,uuid),public.delete_lead_selection(uuid,jsonb),public.undo_lead_selection(uuid),public.save_ai_relevance(uuid,jsonb,text),public.ai_plan_result(uuid,integer) to authenticated;
