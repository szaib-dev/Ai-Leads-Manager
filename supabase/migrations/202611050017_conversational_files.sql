create or replace function public.workspace_leads(p_page uuid default null,p_mode text default 'page',p_search text default '',p_status text default 'all',p_phone boolean default false,p_sort text default 'newest',p_offset integer default 0,p_limit integer default 8)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;begin
 if p_mode not in ('page','attempts','archive','callbacks') or p_sort not in ('newest','name','attempts') or p_offset<0 or p_offset>1000000 or p_limit<1 or p_limit>100 or length(p_search)>200 then raise exception 'Invalid list parameters';end if;
 with eligible as (
 select l.* from public.leads l join public.lead_pages p on p.id=l.page_id and p.owner_id=l.owner_id
 where l.owner_id=(select auth.uid()) and l.deleted_at is null and p.deleted_at is null
 and (p_mode<>'page' or (l.page_id=p_page and l.status in ('new','interested')))
 and (case when p_mode='archive' then l.archived_at is not null else l.archived_at is null end)
 and (p_mode<>'attempts' or l.status in ('no_answer','voicemail'))
 and (p_mode<>'callbacks' or l.status='awaiting_callback')
 ), filtered as (
 select e.*,coalesce(a.total_attempts,0) as attempts,coalesce(a.consecutive_failed_attempts,0) as failed_attempts,a.last_attempt_at,(select notes from public.call_attempts ca where ca.lead_id=e.id and ca.owner_id=e.owner_id and ca.voided_at is null order by occurred_at desc,id desc limit 1) as last_attempt_notes,public.is_lead_suppressed(e.id) as suppressed,f.scheduled_date as followup,f.scheduled_time as followup_time
 from eligible e left join public.lead_attempt_summary a on a.lead_id=e.id and a.owner_id=e.owner_id
 left join public.followups f on f.owner_id=e.owner_id and f.lead_id=e.id and f.completed_at is null and f.cancelled_at is null
 where (p_status='all' or e.status::text=p_status) and (not p_phone or nullif(btrim(e.phone),'') is not null)
 and (p_search='' or e.business_name ilike '%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%'
 or e.phone ilike '%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%'
 or (regexp_replace(p_search,'[^0-9+]','','g')<>'' and regexp_replace(coalesce(e.phone,''),'[^0-9+]','','g') like '%'||regexp_replace(p_search,'[^0-9+]','','g')||'%'))
 ), paged as (
 select * from filtered order by case when p_sort='name' then lower(business_name) end asc,
 case when p_sort='attempts' then attempts end desc,created_at desc,id limit p_limit offset p_offset
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'),
 'total',(select count(*) from filtered),'summary',jsonb_build_object('total',(select count(*) from eligible),
 'ready',(select count(*) from eligible where status='new' and nullif(btrim(phone),'') is not null),
 'contacted',(select count(*) from eligible where last_contacted_at is not null),
 'unanswered',(select count(*) from eligible where status='no_answer'))) into result;
 return result;end $$;


-- Uploaded files are conversation material. Storing one never imports leads.
create table public.ai_chat_files(
 id uuid primary key,owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 conversation_id uuid not null, file_name text not null check(length(file_name) between 1 and 255),
 csv_text text not null check(octet_length(csv_text)<=3500000),message_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(conversation_id,owner_id) references public.ai_conversations(id,owner_id) on delete cascade,
 foreign key(message_id,owner_id) references public.ai_chat_messages(id,owner_id) on delete cascade);
create index chat_files_context on public.ai_chat_files(owner_id,conversation_id,created_at desc);
alter table public.ai_chat_files enable row level security;
revoke all on public.ai_chat_files from public,anon,authenticated;
grant select on public.ai_chat_files to authenticated;
create policy owner_select on public.ai_chat_files for select to authenticated using(owner_id=(select auth.uid()));
create function public.store_chat_file(p_id uuid,p_conversation uuid,p_name text,p_text text) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();begin
 if p_id is null or p_conversation is null or length(p_name) not between 1 and 255 or octet_length(p_text)>3500000 then raise exception 'Invalid attachment';end if;
 if exists(select 1 from public.ai_conversations where id=p_conversation and owner_id<>u) then raise exception 'Conversation unavailable';end if;
 if not exists(select 1 from public.ai_conversations where id=p_conversation) and (select count(*) from public.ai_conversations where owner_id=u)>=200 then raise exception 'Conversation limit reached';end if;
 perform pg_advisory_xact_lock(hashtextextended('chat-files:'||u::text,0));
 if (select coalesce(sum(octet_length(csv_text)),0) from public.ai_chat_files where owner_id=u)>20000000 then raise exception 'Attachment storage full. Delete unused conversations to continue.';end if;
 insert into public.ai_conversations(id,owner_id,title) values(p_conversation,u,left(p_name,80)) on conflict do nothing;
 insert into public.ai_chat_files(id,owner_id,conversation_id,file_name,csv_text) values(p_id,u,p_conversation,p_name,p_text) on conflict(id) do nothing;
 if not exists(select 1 from public.ai_chat_files where id=p_id and owner_id=u and conversation_id=p_conversation and file_name=p_name and csv_text=p_text) then raise exception 'Attachment changed';end if;return p_id;end $$;
create function public.bind_chat_file(p_file uuid,p_message uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();begin
 update public.ai_chat_files f set message_id=p_message where f.id=p_file and f.owner_id=u and (f.message_id is null or f.message_id=p_message) and exists(select 1 from public.ai_chat_messages m where m.id=p_message and m.owner_id=u and m.role='user' and m.conversation_id=f.conversation_id);
 if not found then raise exception 'Attachment unavailable';end if;end $$;
create function public.chat_file_import_artifact(p_message uuid,p_import uuid,p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();b public.imports;a jsonb;begin
 perform private.ai_proof(p_token);
 select * into b from public.imports where id=p_import and owner_id=u and status='completed';if not found then raise exception 'Import unavailable';end if;
 a=jsonb_build_object('kind','import','importId',b.id,'pageId',b.page_id,'fileName',b.file_name,'imported',b.successful_rows,'duplicates',b.skipped_duplicates,'invalid',b.invalid_rows,'status',b.status);
 update public.ai_chat_messages set artifact=a where id=p_message and owner_id=u and role='assistant' and status<>'redacted';if not found then raise exception 'Message unavailable';end if;return a;end $$;
-- Permanent detail removal clears uploaded copies just as it clears chat text.
create function private.clear_chat_files() returns trigger language plpgsql security definer set search_path='' as $$begin
 delete from public.ai_chat_files where owner_id=old.owner_id;return old;end $$;
create trigger clear_chat_files before delete on public.leads for each row execute function private.clear_chat_files();
revoke all on function public.store_chat_file(uuid,uuid,text,text),public.bind_chat_file(uuid,uuid),public.chat_file_import_artifact(uuid,uuid,text),private.clear_chat_files() from public,anon,authenticated;
grant execute on function public.store_chat_file(uuid,uuid,text,text),public.bind_chat_file(uuid,uuid),public.chat_file_import_artifact(uuid,uuid,text) to authenticated;
notify pgrst, 'reload schema';
