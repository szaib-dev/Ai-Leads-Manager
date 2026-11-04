-- UTC pricing reviews prevent a Karachi calendar date being rejected before UTC midnight.
alter table private.ai_runtime add column pricing_reviewed_at timestamptz;
update private.ai_runtime set pricing_reviewed_at=pricing_verified::timestamp at time zone 'Asia/Karachi';
alter table private.ai_runtime alter column pricing_reviewed_at set default clock_timestamp();
alter table private.ai_runtime alter column pricing_reviewed_at set not null;
create function private.ai_pricing_date_compat() returns trigger language plpgsql set search_path='' as $$begin
 if new.pricing_verified is distinct from old.pricing_verified and new.pricing_reviewed_at=old.pricing_reviewed_at then new.pricing_reviewed_at=new.pricing_verified::timestamp at time zone 'Asia/Karachi';end if;return new;
end $$;
create trigger ai_pricing_date_compat before update on private.ai_runtime for each row execute function private.ai_pricing_date_compat();
revoke all on function private.ai_pricing_date_compat() from public,anon,authenticated;

create table public.ai_conversations(
 id uuid primary key,
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 title text not null default 'New chat' check(length(title)<=100),
 scope_page_id uuid,
 last_result_id uuid,
 last_operation_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(id,owner_id),
 foreign key(scope_page_id,owner_id) references public.lead_pages(id,owner_id) on delete set null(scope_page_id),
 foreign key(last_result_id,owner_id) references public.operations(id,owner_id) on delete set null(last_result_id),
 foreign key(last_operation_id,owner_id) references public.operations(id,owner_id) on delete set null(last_operation_id)
);
create index ai_conversations_owner_time on public.ai_conversations(owner_id,updated_at desc,id);
create table public.ai_chat_messages(
 id uuid primary key,
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 conversation_id uuid not null,
 role text not null check(role in('user','assistant')),
 content text not null default '' check(octet_length(content)<=16000),
 status text not null check(status in('completed','processing','failed','interrupted','redacted')),
 error text check(length(error)<=1000),
 reply_to uuid,
 operation_id uuid,
 attempt_id uuid,
 lease_until timestamptz,
 event_key text check(length(event_key)<=120),
 redacted_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(id,owner_id),
 unique(conversation_id,event_key),
 foreign key(conversation_id,owner_id) references public.ai_conversations(id,owner_id) on delete cascade,
 foreign key(reply_to,owner_id) references public.ai_chat_messages(id,owner_id) on delete cascade,
 foreign key(operation_id,owner_id) references public.operations(id,owner_id) on delete set null(operation_id),
 check((role='assistant') or (reply_to is null and operation_id is null))
);
create index ai_chat_thread on public.ai_chat_messages(owner_id,conversation_id,created_at desc,id);
create index ai_chat_operation on public.ai_chat_messages(owner_id,operation_id) where operation_id is not null;
create index ai_chat_retrieval on public.ai_chat_messages using gin(to_tsvector('simple',content));
do $$declare t text;begin foreach t in array array['ai_conversations','ai_chat_messages'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy owner_select on public.%I for select to authenticated using(owner_id=(select auth.uid()))',t);
end loop;end $$;

create function public.ai_chat_claim(p_conversation uuid,p_user uuid,p_assistant uuid,p_content text,p_scope uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();c public.ai_conversations;m public.ai_chat_messages;attempt uuid;begin
 if p_conversation is null or p_user is null or p_assistant is null or p_user=p_assistant or length(btrim(p_content)) not between 1 and 4000 then raise exception 'Invalid chat request';end if;
 if p_scope is not null and not exists(select 1 from public.lead_pages where id=p_scope and owner_id=u and deleted_at is null) then raise exception 'Scope unavailable';end if;
 if not exists(select 1 from public.ai_conversations where id=p_conversation) and (select count(*) from public.ai_conversations where owner_id=u)>=200 then raise exception 'Conversation limit reached';end if;
 insert into public.ai_conversations(id,owner_id,title,scope_page_id) values(p_conversation,u,left(btrim(p_content),80),p_scope) on conflict do nothing;
 select * into c from public.ai_conversations where id=p_conversation and owner_id=u for update;
 if not found then raise exception 'Conversation unavailable' using errcode='42501';end if;
 select * into m from public.ai_chat_messages where id=p_assistant and owner_id=u and conversation_id=c.id;
 if found then
  if m.reply_to<>p_user or not exists(select 1 from public.ai_chat_messages where id=p_user and owner_id=u and conversation_id=c.id and content=p_content) then raise exception 'Retry does not match the original message';end if;
  if m.status in('completed','redacted') then return jsonb_build_object('state','replay','message',to_jsonb(m));end if;
  if m.status='processing' and m.lease_until>clock_timestamp() then return jsonb_build_object('state','busy');end if;
 end if;
 if exists(select 1 from public.ai_chat_messages where conversation_id=c.id and owner_id=u and role='assistant' and status='processing' and lease_until>clock_timestamp() and id<>p_assistant) then return jsonb_build_object('state','busy');end if;
 if not exists(select 1 from public.ai_chat_messages where id=p_user) then
  if (select count(*) from public.ai_chat_messages where owner_id=u and role='user' and created_at>clock_timestamp()-interval '1 minute')>=6 then raise exception 'Please wait before sending another message';end if;
  if (select count(*) from public.ai_chat_messages where conversation_id=c.id)>=1000 then raise exception 'Start a new conversation to continue';end if;
  insert into public.ai_chat_messages(id,owner_id,conversation_id,role,content,status) values(p_user,u,c.id,'user',p_content,'completed');
 elsif not exists(select 1 from public.ai_chat_messages where id=p_user and owner_id=u and conversation_id=c.id and role='user' and content=p_content) then raise exception 'Message ID already used';end if;
 attempt=gen_random_uuid();
 insert into public.ai_chat_messages(id,owner_id,conversation_id,role,reply_to,status,attempt_id,lease_until) values(p_assistant,u,c.id,'assistant',p_user,'processing',attempt,clock_timestamp()+interval '130 seconds')
 on conflict(id) do update set status='processing',error=null,attempt_id=excluded.attempt_id,lease_until=excluded.lease_until,updated_at=clock_timestamp() where public.ai_chat_messages.owner_id=u and public.ai_chat_messages.conversation_id=c.id;
 if not found then raise exception 'Assistant message unavailable';end if;
 update public.ai_conversations set scope_page_id=p_scope,updated_at=clock_timestamp() where id=c.id;
 return jsonb_build_object('state','claimed','attempt',attempt,'previousResult',c.last_result_id,'message',case when m.id is not null then to_jsonb(m) else null end);
end $$;

create function public.ai_chat_finish(p_id uuid,p_attempt uuid,p_content text,p_status text,p_error text,p_operation uuid,p_token text) returns boolean language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();m public.ai_chat_messages;act text;begin
 if p_status not in('completed','failed','interrupted') or octet_length(p_content)>16000 or length(coalesce(p_error,''))>1000 then raise exception 'Invalid chat completion';end if;
 if p_status='completed' or p_operation is not null then perform private.ai_proof(p_token);end if;
 select * into m from public.ai_chat_messages where id=p_id and owner_id=u and role='assistant' for update;
 if m.id is null or m.attempt_id is distinct from p_attempt then return false;end if;
 if p_operation is not null then select ai_action into act from public.operations where id=p_operation and owner_id=u and source='ai';if not found then raise exception 'Operation unavailable';end if;end if;
 if m.status='redacted' then update public.ai_chat_messages set operation_id=p_operation where id=m.id;return false;end if;
 if m.status<>'processing' then return false;end if;
 update public.ai_chat_messages set content=p_content,status=p_status,error=p_error,operation_id=p_operation,lease_until=null,updated_at=clock_timestamp() where id=m.id;
 update public.ai_conversations set updated_at=clock_timestamp(),last_operation_id=coalesce(p_operation,last_operation_id),last_result_id=case when act='search' then p_operation else last_result_id end where id=m.conversation_id and owner_id=u;
 return true;
end $$;

create function public.ai_chat_context(p_conversation uuid,p_before uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid=private.phase3_owner();c public.ai_conversations;stamp timestamptz;question text;recent jsonb;older jsonb;begin
 select * into c from public.ai_conversations where id=p_conversation and owner_id=u;if not found then raise exception 'Conversation unavailable' using errcode='42501';end if;
 select created_at into stamp from public.ai_chat_messages where id=p_before and conversation_id=c.id and owner_id=u;
 select content into question from public.ai_chat_messages where id=(select reply_to from public.ai_chat_messages where id=p_before and owner_id=u);
 with tail as(select id,role,left(content,1000) content,created_at from public.ai_chat_messages where owner_id=u and conversation_id=c.id and created_at<stamp and status='completed' and id<>(select reply_to from public.ai_chat_messages where id=p_before) order by created_at desc,id desc limit 12)
 select coalesce(jsonb_agg(to_jsonb(tail) order by created_at,id),'[]') into recent from tail;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into older from(select role,left(content,600) content from public.ai_chat_messages where owner_id=u and conversation_id=c.id and status='completed' and created_at<coalesce((select min((j->>'created_at')::timestamptz) from jsonb_array_elements(recent)j),stamp) and to_tsvector('simple',content)@@websearch_to_tsquery('simple',left(coalesce(question,''),200)) order by created_at desc limit 4)x;
 return jsonb_build_object('recent',recent,'olderRelevant',older,'previousResult',c.last_result_id,'lastOperation',c.last_operation_id,'scopePage',c.scope_page_id);
end $$;

create function public.ai_chat_event(p_conversation uuid,p_operation uuid,p_content text,p_token text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();o public.operations;begin
 perform private.ai_proof(p_token);
 if not exists(select 1 from public.ai_conversations where id=p_conversation and owner_id=u) then raise exception 'Conversation unavailable';end if;
 select * into o from public.operations where id=p_operation and owner_id=u and source='ai';if not found then raise exception 'Operation unavailable';end if;
 if octet_length(p_content)>4000 then raise exception 'Event too long';end if;
 insert into public.ai_chat_messages(id,owner_id,conversation_id,role,content,status,operation_id,event_key) values(gen_random_uuid(),u,p_conversation,'assistant',p_content,'completed',o.id,o.id::text||':'||o.status::text) on conflict(conversation_id,event_key) do nothing;
 update public.ai_conversations set updated_at=clock_timestamp(),last_operation_id=o.id where id=p_conversation and owner_id=u;
end $$;
revoke all on function public.ai_chat_claim(uuid,uuid,uuid,text,uuid),public.ai_chat_finish(uuid,uuid,text,text,text,uuid,text),public.ai_chat_context(uuid,uuid),public.ai_chat_event(uuid,uuid,text,text) from public,anon;
grant execute on function public.ai_chat_claim(uuid,uuid,uuid,text,uuid),public.ai_chat_finish(uuid,uuid,text,text,text,uuid,text),public.ai_chat_context(uuid,uuid),public.ai_chat_event(uuid,uuid,text,text) to authenticated;

-- Conservatively clear chat text on physical business-detail removal, including generated titles.
-- Keep PII-free operation references/counts, and reject stale in-flight completions.
create or replace function private.ai_purge_privacy() returns trigger language plpgsql security definer set search_path='' as $$begin
 update private.ai_plans p set command=null from public.operations o where o.id=p.operation_id and p.owner_id=old.owner_id and o.status='planned';
 update public.operations set status='failed',finished_at=clock_timestamp() where owner_id=old.owner_id and source='ai' and status='planned';
 update public.ai_chat_messages set content='Conversation text cleared after permanent record removal.',error=null,status='redacted',redacted_at=clock_timestamp() where owner_id=old.owner_id and status<>'redacted';
 update public.ai_conversations set title='Conversation cleared',last_result_id=null where owner_id=old.owner_id and title<>'Conversation cleared';
 return old;
end $$;

-- Shared planner/stream budget: reserve before each call, settle usage once.
create or replace function public.ai_csv_reserve(p_request uuid,p_input_bound integer,p_server_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg private.ai_runtime;used numeric;cost numeric;begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select * into cfg from private.ai_runtime where singleton for update;
 if p_server_token is null or cfg.server_token_hash is null or cfg.server_token_hash<>pg_catalog.sha256(pg_catalog.convert_to(p_server_token,'UTF8')) then raise exception 'AI server configuration is unavailable';end if;
 if cfg.pricing_reviewed_at<clock_timestamp()-interval '30 days' or cfg.pricing_reviewed_at>clock_timestamp()+interval '5 minutes' then raise exception 'Review current provider pricing before enabling AI';end if;
 if p_request is null or p_input_bound not between 1 and 64000 then raise exception 'Invalid AI request';end if;
 if exists(select 1 from private.ai_usage where id=p_request) then raise exception 'This AI request was already submitted';end if;
 if (select count(*) from private.ai_usage where owner_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=12 then raise exception 'Please wait before requesting more AI suggestions';end if;
 select coalesce(sum(coalesce(estimated_usd,reserved_usd)),0) into used from private.ai_usage where created_at>=date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
 -- Input bound uses UTF-8 bytes plus protocol allowance: conservative, no cache discount.
 cost=(p_input_bound*cfg.input_rate+1024*cfg.output_rate)/1000000;
 if used+cost>cfg.monthly_budget then raise exception 'Monthly AI budget exhausted';end if;
 insert into private.ai_usage(id,owner_id,reserved_usd,input_rate,output_rate) values(p_request,auth.uid(),cost,cfg.input_rate,cfg.output_rate);
 return jsonb_build_object('model',cfg.model,'reserved',cost,'remaining',cfg.monthly_budget-used-cost);
end $$;
create or replace function public.ai_csv_settle(p_request uuid,p_input integer,p_output integer,p_server_token text) returns void language plpgsql security definer set search_path='' as $$
declare cfg private.ai_runtime;begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select * into cfg from private.ai_runtime where singleton for update;
 if p_server_token is null or cfg.server_token_hash is null or cfg.server_token_hash<>pg_catalog.sha256(pg_catalog.convert_to(p_server_token,'UTF8')) then raise exception 'Invalid AI server proof';end if;
 if p_input is not null and (p_input<0 or p_input>1000000 or p_output is null or p_output<0 or p_output>1024) then raise exception 'Invalid usage';end if;
 -- An unknown/failed response keeps the full reservation charged conservatively.
 update private.ai_usage set input_tokens=p_input,output_tokens=p_output,estimated_usd=case when p_input is null then reserved_usd else (p_input*input_rate+p_output*output_rate)/1000000 end,settled_at=clock_timestamp() where id=p_request and owner_id=auth.uid() and settled_at is null;
 if not found and not exists(select 1 from private.ai_usage where id=p_request and owner_id=auth.uid() and settled_at is not null) then raise exception 'AI request not found';end if;
end $$;
create or replace function public.ai_csv_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select jsonb_build_object('configured',c.server_token_hash is not null,'budget',c.monthly_budget,'estimated_spent',coalesce(sum(coalesce(u.estimated_usd,u.reserved_usd)),0),'pricing_verified',(c.pricing_reviewed_at at time zone 'UTC')::date,'pricing_reviewed_at',c.pricing_reviewed_at,'input_tokens',coalesce(sum(u.input_tokens),0),'output_tokens',coalesce(sum(u.output_tokens),0),'model',c.model) into result from private.ai_runtime c left join private.ai_usage u on u.created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC' group by c.singleton;
 return result;
end $$;
revoke all on function public.ai_csv_reserve(uuid,integer,text),public.ai_csv_settle(uuid,integer,integer,text),public.ai_csv_status() from public,anon;
grant execute on function public.ai_csv_reserve(uuid,integer,text),public.ai_csv_settle(uuid,integer,integer,text),public.ai_csv_status() to authenticated;
