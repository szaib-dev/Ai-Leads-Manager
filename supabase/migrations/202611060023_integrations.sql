-- Explicit capabilities only; raw secrets and tables are never exposed to API callers.
create table public.integration_keys(
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 80), prefix text not null,
 secret_hash text not null unique check(secret_hash ~ '^[a-f0-9]{64}$'),
 scopes text[] not null check(scopes <@ array['leads.read','leads.create','leads.update','leads.delete','leads.archive','leads.import','meetings.read','meetings.create','meetings.update','meetings.cancel','followups.create']::text[]),
 enabled boolean not null default true, revoked_at timestamptz, expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(), last_used_at timestamptz);
create table public.integration_settings(owner_id uuid primary key references auth.users(id) on delete cascade,enabled boolean not null default true);
create table public.integration_logs(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,key_id uuid not null references public.integration_keys(id) on delete cascade,request_id uuid not null,action text not null,status int not null,code text not null,created_at timestamptz not null default clock_timestamp());
create index integration_logs_owner on public.integration_logs(owner_id,created_at desc);
create index integration_logs_rate on public.integration_logs(key_id,created_at desc);
create table public.integration_receipts(key_id uuid references public.integration_keys(id) on delete cascade,request_id uuid,action text not null,payload_hash text not null,result jsonb not null,primary key(key_id,request_id));
alter table public.integration_keys enable row level security;
alter table public.integration_settings enable row level security;
alter table public.integration_logs enable row level security;
alter table public.integration_receipts enable row level security;
revoke all on public.integration_keys,public.integration_settings,public.integration_logs,public.integration_receipts from public,anon,authenticated;
create function public.integration_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();begin
 return jsonb_build_object('enabled',coalesce((select enabled from public.integration_settings where owner_id=u),true),
 'keys',(select coalesce(jsonb_agg(to_jsonb(k) order by created_at desc),'[]') from(select id,name,prefix,scopes,enabled,revoked_at,expires_at,created_at,last_used_at from public.integration_keys where owner_id=u)k),
 'logs',(select coalesce(jsonb_agg(to_jsonb(l) order by created_at desc),'[]') from(select id,key_id,request_id,action,status,code,created_at from public.integration_logs where owner_id=u order by created_at desc limit 30)l));end $$;
create function public.integration_toggle(p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();begin
 if p_enabled is null then raise exception 'Invalid setting';end if;
 perform pg_advisory_xact_lock(hashtextextended('folio:api:'||u::text,0));
 insert into public.integration_settings values(u,p_enabled) on conflict(owner_id) do update set enabled=excluded.enabled;
end $$;
create function public.integration_manage_key(p_id uuid,p_name text,p_scopes text[],p_enabled boolean,p_revoke boolean,p_hash text,p_prefix text,p_expires timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();result uuid;begin
 perform pg_advisory_xact_lock(hashtextextended('folio:api:'||u::text,0));
 if p_scopes is null or cardinality(p_scopes)>11 or not(p_scopes <@ array['leads.read','leads.create','leads.update','leads.delete','leads.archive','leads.import','meetings.read','meetings.create','meetings.update','meetings.cancel','followups.create']::text[]) or p_enabled is null or p_revoke is null then raise exception 'Invalid permissions';end if;
 if p_id is null then
 if (select count(*) from public.integration_keys where owner_id=u and revoked_at is null)>=20 then raise exception 'Revoke an existing key first';end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 80 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_prefix is null or p_prefix !~ '^folio_[a-f0-9]{8}$' or p_expires is null or p_expires<=clock_timestamp() or p_expires>clock_timestamp()+interval '366 days' then raise exception 'Invalid key details';end if;
 insert into public.integration_keys(owner_id,name,prefix,secret_hash,scopes,enabled,expires_at) values(u,btrim(p_name),p_prefix,p_hash,p_scopes,p_enabled,p_expires) returning id into result;
 else
 update public.integration_keys set scopes=p_scopes,enabled=case when p_revoke then false else p_enabled end,revoked_at=case when p_revoke then clock_timestamp() else null end where id=p_id and owner_id=u and revoked_at is null returning id into result;
 if not found then raise exception 'Key unavailable or revoked';end if;
 end if;return result;
end $$;
create function public.integration_request(p_token text,p_action text,p_payload jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare k public.integration_keys%rowtype;u uuid;needed text;s int=200;code text='ok';result jsonb;receipt public.integration_receipts%rowtype;hash text;op uuid;
 l public.leads%rowtype;f public.followups%rowtype;data jsonb;instant timestamptz;zone text;notes text;localday date;meeting_time time;mid uuid;
 prior_sub text=current_setting('request.jwt.claim.sub',true);prior_claims text=current_setting('request.jwt.claims',true);
begin
 if p_token is null or p_token !~ '^folio_[a-f0-9]{64}$' then return jsonb_build_object('status',401,'body',jsonb_build_object('error',jsonb_build_object('code','invalid_api_key')));end if;
 select * into k from public.integration_keys where secret_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if not found then return jsonb_build_object('status',401,'body',jsonb_build_object('error',jsonb_build_object('code','invalid_api_key')));end if;
 u=k.owner_id;perform pg_advisory_xact_lock(hashtextextended('folio:api:'||u::text,0));
 select * into k from public.integration_keys where id=k.id for update;
 if p_request is null or p_action is null or length(p_action)>40 then return jsonb_build_object('status',400,'body',jsonb_build_object('error',jsonb_build_object('code','invalid_request')));end if;
 needed=case when p_action in('pages.list','leads.search','leads.get') then 'leads.read' when p_action='meetings.list' then 'meetings.read' when p_action in('leads.create','leads.update','leads.delete','leads.archive','leads.import','meetings.create','meetings.update','meetings.cancel','followups.create') then p_action end;
 if k.revoked_at is not null or k.expires_at<=clock_timestamp() then s=401;code='invalid_api_key';
 elsif not k.enabled or not coalesce((select enabled from public.integration_settings where owner_id=u),true) then s=403;code='api_disabled';
 elsif needed is null then s=400;code='unknown_action';
 elsif not(needed=any(k.scopes)) then s=403;code='permission_disabled';
 elsif (select count(*) from public.integration_logs where key_id=k.id and created_at>clock_timestamp()-interval '1 minute')>=60 then s=429;code='rate_limited';end if;
 if s=200 then
 begin
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>32768 then raise exception 'Invalid payload';end if;
 hash=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');op=md5(k.id::text||p_request::text)::uuid;
 select * into receipt from public.integration_receipts where key_id=k.id and request_id=p_request;
 if found then
 if receipt.action<>p_action or receipt.payload_hash<>hash then s=409;code='idempotency_conflict';else result=receipt.result;end if;
 else
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 if p_action='pages.list' then
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'countryId',country_id)),'[]') into result from public.lead_pages where owner_id=u and deleted_at is null;
 elsif p_action='leads.search' then
 if length(coalesce(p_payload->>'query',''))>200 or coalesce((p_payload->>'limit')::int,20) not between 1 and 50 or coalesce((p_payload->>'offset')::int,0) not between 0 and 100000 then raise exception 'Invalid pagination';end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from(select l.id,l.page_id,l.business_name,l.phone,l.status,l.updated_at from public.leads l join public.lead_pages p on p.id=l.page_id where l.owner_id=u and l.deleted_at is null and p.deleted_at is null and (not(p_payload?'pageId') or l.page_id=(p_payload->>'pageId')::uuid) and strpos(lower(l.business_name),lower(coalesce(p_payload->>'query','')))>0 order by l.business_name,l.id limit coalesce((p_payload->>'limit')::int,20) offset coalesce((p_payload->>'offset')::int,0))t;
 elsif p_action in('leads.create','leads.import') then
 data=case when p_action='leads.create' then jsonb_build_array(p_payload->'lead') else p_payload->'rows' end;
 if jsonb_typeof(data) is distinct from 'array' or jsonb_array_length(data) not between 1 and 200 or exists(select 1 from jsonb_array_elements(data)x where x->>'status' is distinct from 'new') then raise exception 'New leads only';end if;
 result=public.commit_import(op,(p_payload->>'pageId')::uuid,null,'append','Integration API',data,jsonb_array_length(data),0);
 elsif p_action='meetings.list' then
 if coalesce((p_payload->>'offset')::int,0) not between 0 and 100000 then raise exception 'Invalid pagination';end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from(select f.id,f.lead_id,l.business_name,f.scheduled_date,f.scheduled_time,f.notes,l.updated_at from public.followups f join public.leads l on l.id=f.lead_id join public.lead_pages p on p.id=l.page_id where f.owner_id=u and f.kind='meeting' and f.cancelled_at is null and f.completed_at is null and l.deleted_at is null and l.archived_at is null and p.deleted_at is null and (not(p_payload?'leadId') or l.id=(p_payload->>'leadId')::uuid) order by f.scheduled_date,f.id limit 50 offset coalesce((p_payload->>'offset')::int,0))t;
 else
 select * into l from public.leads where id=coalesce(p_payload->>'id',p_payload->>'leadId')::uuid and owner_id=u and deleted_at is null and exists(select 1 from public.lead_pages p where p.id=page_id and p.deleted_at is null);
 -- Meeting payload id identifies a follow-up, not the lead.
 if p_action in('meetings.update','meetings.cancel') then select * into l from public.leads where id=(p_payload->>'leadId')::uuid and owner_id=u and deleted_at is null and exists(select 1 from public.lead_pages p where p.id=page_id and p.deleted_at is null);end if;
 if l.id is null then s=404;code='lead_not_found';
 elsif p_action='leads.get' then select to_jsonb(t) into result from(select id,page_id,business_name,phone,website_url,google_maps_url,country,location,notes,status,updated_at from public.leads where id=l.id)t;
 elsif l.updated_at is distinct from (p_payload->>'expectedUpdatedAt')::timestamptz then s=409;code='stale_lead';
 elsif p_action in('leads.update','leads.delete','leads.archive') then
 data=coalesce(p_payload->'changes','{}');
 if jsonb_typeof(data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(data)t where t not in('business_name','phone','website_url','country','location','notes','status')) or (data?'status' and data->>'status' not in('new','interested','no_answer','voicemail','awaiting_callback','not_interested')) then raise exception 'Invalid fields';end if;
 if exists(select 1 from public.followups where lead_id=l.id and kind='meeting' and completed_at is null and cancelled_at is null) and (data?'status' or p_action<>'leads.update') then s=409;code='use_meetings_endpoint';else
 perform public.save_lead(l.id,l.updated_at,data,case p_action when 'leads.delete' then 'delete' when 'leads.archive' then 'archive' else 'edit' end);
 select jsonb_build_object('id',id,'updated_at',updated_at) into result from public.leads where id=l.id;end if;
 else
 if l.archived_at is not null then raise exception 'Archived lead';end if;
 if p_action in('meetings.update','meetings.cancel') then
 select * into f from public.followups where id=(p_payload->>'id')::uuid and lead_id=l.id and owner_id=u and kind='meeting' and completed_at is null and cancelled_at is null;
 if not found then s=404;code='meeting_not_found';end if;end if;
 if s=200 then
 if p_action='meetings.cancel' then
 perform public.manage_followup(l.id,l.updated_at,op,f.id,'cancel',null,null,'');result=jsonb_build_object('id',f.id,'cancelled',true);
 else
 zone=p_payload->>'timezone';instant=(p_payload->>'startsAt')::timestamptz;
 if p_payload->>'startsAt' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or zone is null or not exists(select 1 from pg_timezone_names where name=zone) or instant is null or instant<=clock_timestamp() then raise exception 'Explicit future instant/timezone required';end if;
 localday=(instant at time zone 'Asia/Karachi')::date;meeting_time=(instant at time zone 'Asia/Karachi')::time;
 notes=coalesce(p_payload->>'notes','')||E'
Timezone: '||zone||' | Instant: '||to_char(instant at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');
 if p_action in('meetings.create','followups.create') then
 if exists(select 1 from public.followups where lead_id=l.id and completed_at is null and cancelled_at is null) then s=409;code='pending_schedule_exists';
 elsif p_action='meetings.create' then perform public.save_lead(l.id,l.updated_at,jsonb_build_object('status','meeting_booked','scheduled_date',localday,'scheduled_time',to_char(meeting_time,'HH24:MI'),'notes',notes),'edit');
 else perform public.manage_followup(l.id,l.updated_at,op,null,'schedule',localday,meeting_time,notes);end if;
 else perform public.manage_followup(l.id,l.updated_at,op,f.id,'schedule',localday,meeting_time,notes);end if;
 if s=200 then select id into mid from public.followups where lead_id=l.id and owner_id=u and completed_at is null and cancelled_at is null order by created_at desc limit 1;select jsonb_build_object('id',mid,'leadId',l.id,'startsAt',instant,'timezone',zone,'updated_at',updated_at) into result from public.leads where id=l.id;end if;
 end if;end if;
 end if;
 end if;
 if s=200 and p_action not in('pages.list','leads.search','leads.get','meetings.list') then insert into public.integration_receipts values(k.id,p_request,p_action,hash,result);end if;
 end if;
 exception when others then s=422;code='request_rejected';result=null;
 end;
 end if;
 perform set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true);perform set_config('request.jwt.claims',coalesce(prior_claims,'{}'),true);
 update public.integration_keys set last_used_at=clock_timestamp() where id=k.id;
 insert into public.integration_logs(owner_id,key_id,request_id,action,status,code) values(u,k.id,p_request,p_action,s,code);
 return jsonb_build_object('status',s,'body',case when s=200 then jsonb_build_object('data',result) else jsonb_build_object('error',jsonb_build_object('code',code)) end);
end $$;
revoke all on function public.integration_state(),public.integration_toggle(boolean),public.integration_manage_key(uuid,text,text[],boolean,boolean,text,text,timestamptz),public.integration_request(text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.integration_state(),public.integration_toggle(boolean),public.integration_manage_key(uuid,text,text[],boolean,boolean,text,text,timestamptz) to authenticated;
grant execute on function public.integration_request(text,text,jsonb,uuid) to anon,authenticated;
notify pgrst,'reload schema';
