-- OAuth has a separate non-inheriting role: never grant authenticated membership.
do $$begin if not exists(select 1 from pg_roles where rolname='folio_oauth') then create role folio_oauth nologin noinherit;end if;end $$;
-- Refuse to reuse a privileged role left by unrelated/manual setup.
do $$begin
 if exists(select 1 from pg_roles where rolname='folio_oauth' and
 (rolsuper or rolcanlogin or rolbypassrls or rolinherit)) or
 exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname='folio_oauth')
 then raise exception 'folio_oauth must be an unprivileged isolated role';end if;
end $$;
grant folio_oauth to authenticator;
grant usage on schema public to folio_oauth;
-- PUBLIC is inherited even by NOINHERIT roles. Before removing that implicit
-- access, materialize the EXACT same existing execute access for browser/API
-- roles. This adds no effective privilege and preserves legacy RPCs that relied
-- on PUBLIC rather than explicit grants. Explicitly revoked RPCs stay revoked.
-- Other deployed custom roles must be inventoried separately in staging.
do $$declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind='f'
 and exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 where a.grantee=0 and a.privilege_type='EXECUTE') loop
 execute format('grant execute on function %s to anon, authenticated',f.signature);
 if exists(select 1 from pg_roles where rolname='service_role') then
 execute format('grant execute on function %s to service_role',f.signature);end if;
 execute format('revoke execute on function %s from public',f.signature);
 end loop;
end $$;
alter default privileges in schema public revoke execute on functions from public;
create table private.oauth_config(resource text primary key check(resource ~ '^https://[^/]+/mcp$' or resource ~ '^http://(localhost|127[.]0[.]0[.]1):[0-9]{1,5}/mcp$'));
create table private.oauth_grants(
 owner_id uuid not null references auth.users(id) on delete cascade,
 client_id uuid not null, key_id uuid not null references public.integration_keys(id),
 valid_after bigint not null, primary key(owner_id,client_id));
revoke all on private.oauth_config,private.oauth_grants from public,anon,authenticated,folio_oauth;
create or replace function private.integration_execute(p_key uuid,p_action text,p_payload jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare k public.integration_keys%rowtype;u uuid;needed text;s int=200;code text='ok';result jsonb;receipt public.integration_receipts%rowtype;hash text;op uuid;
 l public.leads%rowtype;f public.followups%rowtype;data jsonb;instant timestamptz;zone text;notes text;localday date;meeting_time time;mid uuid;
 prior_sub text=current_setting('request.jwt.claim.sub',true);prior_claims text=current_setting('request.jwt.claims',true);
begin
 select * into k from public.integration_keys where id=p_key;
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
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from(select lead_row.id,lead_row.page_id,lead_row.business_name,lead_row.phone,lead_row.status,lead_row.updated_at from public.leads lead_row join public.lead_pages p on p.id=lead_row.page_id where lead_row.owner_id=u and lead_row.deleted_at is null and p.deleted_at is null and (not(p_payload?'pageId') or lead_row.page_id=(p_payload->>'pageId')::uuid) and strpos(lower(lead_row.business_name),lower(coalesce(p_payload->>'query','')))>0 order by lead_row.business_name,lead_row.id limit coalesce((p_payload->>'limit')::int,20) offset coalesce((p_payload->>'offset')::int,0))t;
 elsif p_action in('leads.create','leads.import') then
 data=case when p_action='leads.create' then jsonb_build_array(p_payload->'lead') else p_payload->'rows' end;
 if jsonb_typeof(data) is distinct from 'array' or jsonb_array_length(data) not between 1 and 200 or exists(select 1 from jsonb_array_elements(data)x where x->>'status' is distinct from 'new') then raise exception 'New leads only';end if;
 result=public.commit_import(op,(p_payload->>'pageId')::uuid,null,'append','Integration API',data,jsonb_array_length(data),0);
 elsif p_action='meetings.list' then
 if coalesce((p_payload->>'offset')::int,0) not between 0 and 100000 then raise exception 'Invalid pagination';end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from(select task_row.id,task_row.lead_id,lead_row.business_name,task_row.scheduled_date,task_row.scheduled_time,task_row.notes,lead_row.updated_at from public.followups task_row join public.leads lead_row on lead_row.id=task_row.lead_id join public.lead_pages p on p.id=lead_row.page_id where task_row.owner_id=u and task_row.kind='meeting' and task_row.cancelled_at is null and task_row.completed_at is null and lead_row.deleted_at is null and lead_row.archived_at is null and p.deleted_at is null and (not(p_payload?'leadId') or lead_row.id=(p_payload->>'leadId')::uuid) order by task_row.scheduled_date,task_row.id limit 50 offset coalesce((p_payload->>'offset')::int,0))t;
 else
 select * into l from public.leads where id=coalesce(p_payload->>'id',p_payload->>'leadId')::uuid and owner_id=u and deleted_at is null and exists(select 1 from public.lead_pages p where p.id=page_id and p.deleted_at is null);
 -- Meeting payload id identifies a follow-up, not the lead.
 if p_action in('meetings.update','meetings.cancel') then select * into l from public.leads where id=(p_payload->>'leadId')::uuid and owner_id=u and deleted_at is null and exists(select 1 from public.lead_pages p where p.id=page_id and p.deleted_at is null);end if;
 if l.id is null then s=404;code='lead_not_found';
 elsif p_action='leads.get' then select to_jsonb(t) into result from(select lead_row.id,lead_row.page_id,lead_row.business_name,lead_row.phone,lead_row.website_url,lead_row.google_maps_url,lead_row.country,lead_row.location,lead_row.notes,lead_row.status,lead_row.updated_at from public.leads lead_row where lead_row.id=l.id)t;
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

revoke all on function private.integration_execute(uuid,text,jsonb,uuid) from public,anon,authenticated,folio_oauth;
create function public.folio_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare claims jsonb=event->'claims'; resource text;
begin
 if nullif(claims->>'client_id','') is not null then
 select c.resource into strict resource from private.oauth_config c;
 claims=claims || jsonb_build_object('role','folio_oauth','aud',resource,'folio_purpose','mcp_access');
 end if;
 return jsonb_build_object('claims',claims);
end $$;
revoke all on function public.folio_access_token_hook(jsonb) from public,anon,authenticated,folio_oauth;
grant execute on function public.folio_access_token_hook(jsonb) to supabase_auth_admin;
create function public.folio_oauth_grant(p_client uuid,p_name text,p_scopes text[],p_revoke boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner(); k uuid;
begin
 if nullif(auth.jwt()->>'client_id','') is not null then raise exception 'Browser session required';end if;
 perform pg_advisory_xact_lock(hashtextextended('folio:api:'||u::text,0));
 select key_id into k from private.oauth_grants where owner_id=u and client_id=p_client;
 if k is not null then update public.integration_keys set enabled=false,revoked_at=clock_timestamp() where id=k;end if;
 if p_revoke then return;end if;
 -- Reuse the existing validated capability, audit and rate-limit principal. No key secret exists.
 k=public.integration_manage_key(null,left('OAuth: '||p_name,80),p_scopes,true,false,
 encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'),'folio_00000000',clock_timestamp()+interval '90 days');
 insert into private.oauth_grants values(u,p_client,k,ceil(extract(epoch from clock_timestamp()))::bigint)
 on conflict(owner_id,client_id) do update set key_id=excluded.key_id,valid_after=excluded.valid_after;
end $$;
revoke all on function public.folio_oauth_grant(uuid,text,text[],boolean) from public,anon,folio_oauth;
grant execute on function public.folio_oauth_grant(uuid,text,text[],boolean) to authenticated;
create function public.folio_oauth_request(p_action text,p_payload jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb=auth.jwt(); k uuid;u uuid=auth.uid();resource text;
begin
 select oc.resource into strict resource from private.oauth_config oc;
 if c->>'role' is distinct from 'folio_oauth' or c->>'folio_purpose' is distinct from 'mcp_access'
 or c->>'aud' is distinct from resource or (c->>'exp')::bigint<=extract(epoch from clock_timestamp()) then
 raise exception 'Invalid OAuth token' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('folio:api:'||u::text,0));
 select g.key_id into k from private.oauth_grants g where g.owner_id=u and g.client_id=(c->>'client_id')::uuid and (c->>'iat')::bigint>=g.valid_after;
 if k is null then return jsonb_build_object('status',403,'body',jsonb_build_object('error',jsonb_build_object('code','client_not_authorized')));end if;
 return private.integration_execute(k,p_action,p_payload,p_request);
end $$;
revoke all on function public.folio_oauth_request(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.folio_oauth_request(text,jsonb,uuid) to folio_oauth;
-- Existing browser policies only target authenticated. folio_oauth has no table,
-- sequence, storage, realtime, or other RPC privileges and cannot assume that role.
notify pgrst,'reload schema';
