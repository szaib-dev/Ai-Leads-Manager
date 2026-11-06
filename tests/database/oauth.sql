\set ON_ERROR_STOP on
begin;
insert into private.oauth_config values('https://folio.example/mcp');
insert into auth.users values('a0000000-0000-4000-8000-000000000001'),('b0000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.folio_oauth_grant('c0000000-0000-4000-8000-000000000001','Disposable test client',array['leads.read','leads.create','leads.update','meetings.create'],false);
do $$declare p uuid;l uuid;stamp text;r jsonb;c jsonb;
begin
 p=public.manage_page(null,'OAuth disposable','',false);
 c=jsonb_build_object('sub','a0000000-0000-4000-8000-000000000001','role','folio_oauth','client_id','c0000000-0000-4000-8000-000000000001','folio_purpose','mcp_access','aud','https://folio.example/mcp','iat',ceil(extract(epoch from clock_timestamp()))+1,'exp',floor(extract(epoch from clock_timestamp()))::bigint+300);
 perform set_config('request.jwt.claims',c::text,true);
 r=public.folio_oauth_request('leads.create',jsonb_build_object('pageId',p,'lead',jsonb_build_object('business_name','OAuth QA','status','new')),gen_random_uuid());
 if r->>'status'<>'200' then raise exception 'Create failed: %',r;end if;
 select id,updated_at::text into l,stamp from public.leads where page_id=p;
 r=public.folio_oauth_request('leads.update',jsonb_build_object('id',l,'expectedUpdatedAt',stamp,'changes',jsonb_build_object('notes','Disposable QA')),gen_random_uuid());
 if r->>'status'<>'200' then raise exception 'Update failed: %',r;end if;
 select updated_at::text into stamp from public.leads where id=l;
 r=public.folio_oauth_request('meetings.create',jsonb_build_object('leadId',l,'expectedUpdatedAt',stamp,'startsAt','2030-12-01T10:00:00Z','timezone','UTC'),gen_random_uuid());
 if r->>'status'<>'200' then raise exception 'Schedule failed: %',r;end if;
 r=public.folio_oauth_request('leads.get',jsonb_build_object('id',l),gen_random_uuid());
 if r->>'status'<>'200' then raise exception 'Read failed';end if;
 r=public.folio_oauth_request('leads.delete','{}',gen_random_uuid());
 if r->>'status'<>'403' then raise exception 'Permission bypass';end if;
 perform set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000001',true);
 r=public.folio_oauth_request('leads.get',jsonb_build_object('id',l),gen_random_uuid());
 if r->>'status'<>'403' then raise exception 'Cross-owner bypass';end if;
 perform set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
 update public.integration_keys set revoked_at=clock_timestamp() where name='OAuth: Disposable test client';
 r=public.folio_oauth_request('pages.list','{}',gen_random_uuid());
 if r->>'status'<>'401' then raise exception 'Revocation bypass';end if;
end $$;
set local role folio_oauth;
do $$declare f record;t record;begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname<>'folio_oauth_request' loop
 if has_function_privilege(current_user,f.oid,'execute') then raise exception 'Unexpected RPC privilege: %',f.oid::regprocedure;end if;end loop;
 for t in select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p') loop
 if has_table_privilege(current_user,t.oid,'select,insert,update,delete') then raise exception 'Unexpected table privilege';end if;end loop;
 begin perform public.integration_state();raise exception 'RPC escalation';exception when insufficient_privilege then null;end;
 begin perform * from public.leads;raise exception 'Direct access';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
