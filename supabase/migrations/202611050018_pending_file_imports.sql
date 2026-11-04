alter table public.ai_chat_files add column pending_import jsonb check(pending_import is null or (jsonb_typeof(pending_import)='object' and octet_length(pending_import::text)<=16000));
create function public.set_chat_file_plan(p_file uuid,p_plan jsonb,p_token text) returns void language plpgsql security definer set search_path='' as $$declare u uuid=private.phase3_owner();begin
 perform private.ai_proof(p_token);
 update public.ai_chat_files set pending_import=p_plan where id=p_file and owner_id=u;
 if not found then raise exception 'File unavailable';end if;end $$;
revoke all on function public.set_chat_file_plan(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.set_chat_file_plan(uuid,jsonb,text) to authenticated;
notify pgrst,'reload schema';
