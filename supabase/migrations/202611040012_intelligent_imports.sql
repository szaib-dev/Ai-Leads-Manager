-- Opt-in import automation remains private and authenticated.
alter table public.workspace_preferences add column csv_import_mode text not null default 'manual' check(csv_import_mode in('manual','automatic'));
create function public.import_preferences() returns jsonb language plpgsql stable security definer set search_path='' as $$declare u uuid=private.phase3_owner();begin return jsonb_build_object('mode',coalesce((select csv_import_mode from public.workspace_preferences where owner_id=u),'manual'));end $$;
create function public.set_import_mode(p_mode text) returns void language plpgsql security definer set search_path='' as $$declare u uuid=private.phase3_owner();begin if p_mode not in('manual','automatic') or p_mode is null then raise exception 'Invalid import mode';end if;insert into public.workspace_preferences(owner_id,csv_import_mode)values(u,p_mode)on conflict(owner_id)do update set csv_import_mode=excluded.csv_import_mode;end $$;
revoke all on function public.import_preferences(),public.set_import_mode(text) from public,anon;
grant execute on function public.import_preferences(),public.set_import_mode(text) to authenticated;

-- Only a hash of the exact URL survives in the reimport marker ledger; never names or contact details.
create table private.deleted_page_maps(owner_id uuid not null references auth.users(id) on delete cascade,url_hash bytea not null,primary key(owner_id,url_hash));
revoke all on private.deleted_page_maps from public,anon,authenticated;
insert into private.deleted_page_maps select distinct l.owner_id,sha256(convert_to(l.google_maps_url,'UTF8')) from public.leads l join public.lead_pages p on p.id=l.page_id where p.deleted_at is not null and l.google_maps_url is not null on conflict do nothing;
alter table public.leads add column maps_active boolean not null default true;
alter table public.leads add column previously_imported boolean not null default false;
update public.leads l set maps_active=false from public.lead_pages p where p.id=l.page_id and p.deleted_at is not null;
drop index public.leads_owner_maps_url_unique;
create unique index leads_owner_maps_url_unique on public.leads(owner_id,google_maps_url) where google_maps_url is not null and maps_active;
create function private.reimport_marker() returns trigger language plpgsql security definer set search_path='' as $$begin
 new.maps_active=exists(select 1 from public.lead_pages p where p.id=new.page_id and p.owner_id=new.owner_id and p.deleted_at is null);
 if tg_op='INSERT' then new.previously_imported=new.google_maps_url is not null and exists(select 1 from private.deleted_page_maps where owner_id=new.owner_id and url_hash=sha256(convert_to(new.google_maps_url,'UTF8')));end if;return new;
end $$;
create trigger reimport_marker before insert or update on public.leads for each row execute function private.reimport_marker();
create function private.deleted_page_identifiers() returns trigger language plpgsql security definer set search_path='' as $$begin
 if old.deleted_at is null and new.deleted_at is not null then
  perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||new.owner_id::text,0));
  insert into private.deleted_page_maps select owner_id,sha256(convert_to(google_maps_url,'UTF8')) from public.leads where page_id=new.id and google_maps_url is not null on conflict do nothing;
  update public.leads set maps_active=false where page_id=new.id and owner_id=new.owner_id;
 elsif old.deleted_at is not null and new.deleted_at is null then update public.leads set maps_active=true where page_id=new.id and owner_id=new.owner_id;end if;return new;
end $$;
create trigger deleted_page_identifiers after update of deleted_at on public.lead_pages for each row execute function private.deleted_page_identifiers();
revoke all on function private.reimport_marker(),private.deleted_page_identifiers() from public,anon,authenticated;
create function public.acknowledge_reimport(p_id uuid,p_expected timestamptz) returns void language plpgsql security definer set search_path='' as $$declare u uuid=private.phase3_owner();begin
 update public.leads l set previously_imported=false where l.id=p_id and l.owner_id=u and l.updated_at=p_expected and l.deleted_at is null and exists(select 1 from public.lead_pages p where p.id=l.page_id and p.deleted_at is null);if not found then raise exception 'Lead changed or is unavailable';end if;end $$;
revoke all on function public.acknowledge_reimport(uuid,timestamptz) from public,anon;
grant execute on function public.acknowledge_reimport(uuid,timestamptz) to authenticated;
create or replace function public.commit_import(p_request uuid,p_page uuid,p_new_name text,p_mode text,p_file text,p_rows jsonb,p_total integer,p_invalid integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();target uuid=p_page;batch public.imports%rowtype;r jsonb;new_id uuid;inserted integer=0;duplicates integer=0;replaced integer=0;stamp timestamptz=clock_timestamp();begin
 if p_mode not in ('append','replace','new') or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>10000 or octet_length(p_rows::text)>8000000 or p_total<1 or p_invalid<0 or p_total<>jsonb_array_length(p_rows)+p_invalid then raise exception 'Invalid import payload';end if;
 perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 select * into batch from public.imports where owner_id=u and request_id=p_request;
 if found then return jsonb_build_object('id',batch.id,'pageId',batch.page_id,'imported',batch.successful_rows,'duplicates',batch.skipped_duplicates,'invalid',batch.invalid_rows,'replaced',batch.replaced_count);end if;
 if jsonb_array_length(p_rows)=0 then raise exception 'No valid rows to import';end if;
 if p_mode='new' then
  if length(btrim(p_new_name)) not between 1 and 100 then raise exception 'Invalid new page name';end if;
  insert into public.lead_pages(owner_id,name) values(u,btrim(p_new_name)) returning id into target;
 elsif not exists(select 1 from public.lead_pages where id=target and owner_id=u and deleted_at is null) then raise exception 'Page unavailable' using errcode='42501';end if;
 insert into public.imports(owner_id,page_id,file_name,status,mode,request_id,total_rows,invalid_rows) values(u,target,p_file,'processing',p_mode,p_request,p_total,p_invalid) returning * into batch;
 if p_mode='replace' then
  -- Keep same-URL originals on this page visible. All other previous rows are hidden, never overwritten.
  insert into public.import_members(owner_id,import_id,page_id,lead_id,role,expected_updated_at,expected_deleted_at)
  select u,batch.id,target,l.id,'replaced',stamp,stamp from public.leads l where l.owner_id=u and l.page_id=target and l.deleted_at is null
  and not exists(select 1 from jsonb_array_elements(p_rows) x where nullif(x->>'google_maps_url','') is not null and x->>'google_maps_url'=l.google_maps_url);
  update public.leads set deleted_at=stamp where id in(select lead_id from public.import_members where import_id=batch.id and role='replaced');
  update public.import_members m set expected_updated_at=l.updated_at from public.leads l where m.import_id=batch.id and m.lead_id=l.id;
  get diagnostics replaced=row_count;
 end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r)<>'object' or exists(select 1 from jsonb_object_keys(r) k where k not in ('business_name','phone','website_url','google_maps_url','country','location','notes','status')) then raise exception 'Invalid import fields';end if;
  new_id=null;
  insert into public.leads(owner_id,page_id,import_id,business_name,phone,website_url,google_maps_url,country,location,notes,status)
  values(u,target,batch.id,r->>'business_name',nullif(r->>'phone',''),nullif(r->>'website_url',''),nullif(r->>'google_maps_url',''),nullif(r->>'country',''),nullif(r->>'location',''),coalesce(r->>'notes',''),coalesce((r->>'status')::public.lead_status,'new'))
  on conflict(owner_id,google_maps_url) where google_maps_url is not null and maps_active do nothing returning id into new_id;
  if new_id is null then duplicates=duplicates+1;
  else
   inserted=inserted+1;
   insert into public.import_members(owner_id,import_id,page_id,lead_id,role,expected_updated_at)
   select u,batch.id,target,id,'inserted',updated_at from public.leads where id=new_id;
  end if;
 end loop;
 update public.imports set status='completed',successful_rows=inserted,skipped_duplicates=duplicates,replaced_count=replaced,completed_at=clock_timestamp() where id=batch.id;
 return jsonb_build_object('id',batch.id,'pageId',target,'imported',inserted,'duplicates',duplicates,'invalid',p_invalid,'replaced',replaced);
end $$;
create or replace function public.preview_import(p_urls jsonb) returns integer language plpgsql stable security invoker set search_path='' as $$declare result integer;begin
 if jsonb_typeof(p_urls)<>'array' or jsonb_array_length(p_urls)>10000 then raise exception 'Invalid preview';end if;
 with urls as(select value #>> '{}' as url from jsonb_array_elements(p_urls)),grouped as(select url,count(*) n from urls where url is not null and url<>'' group by url)
 select coalesce(sum(case when exists(select 1 from public.leads l join public.lead_pages p on p.id=l.page_id where l.owner_id=auth.uid() and p.deleted_at is null and l.maps_active and l.google_maps_url=g.url collate "C")then n else n-1 end),0)::integer into result from grouped g;return result;end $$;

-- Extend the existing authorized snapshot, keeping records bounded and aggregates in SQL.
alter function public.ai_plan_result(uuid,integer) rename to ai_plan_result_base;
revoke all on function public.ai_plan_result_base(uuid,integer) from public,anon,authenticated;
create function public.ai_plan_result(p_id uuid,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid=private.phase3_owner();result jsonb;stats jsonb;batch jsonb;begin
 result=public.ai_plan_result_base(p_id,p_offset);
 select coalesce(jsonb_agg(to_jsonb(s)),'[]') into stats from(select l.status::text label,count(*)::int count from private.ai_targets t join public.leads l on l.id=t.lead_id and l.owner_id=u where t.operation_id=p_id and t.owner_id=u group by l.status)s;
 select jsonb_build_object('id',i.id,'fileName',i.file_name,'imported',i.successful_rows,'duplicates',i.skipped_duplicates,'invalid',i.invalid_rows,'status',i.status) into batch from public.imports i where i.id=(result#>>'{scope,importId}')::uuid and i.owner_id=u;
 return result||jsonb_build_object('statistics',stats)||case when batch is not null then jsonb_build_object('importSummary',batch)else '{}'::jsonb end;
end $$;
revoke all on function public.ai_plan_result(uuid,integer) from public,anon;
grant execute on function public.ai_plan_result(uuid,integer) to authenticated;
create or replace function private.preserve_maps_original() returns trigger language plpgsql volatile security definer set search_path='' as $$begin
 if new.google_maps_url is not null then
  perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||new.owner_id::text,0));
  if exists(select 1 from public.leads l join public.lead_pages p on p.id=l.page_id where l.owner_id=new.owner_id and p.deleted_at is null and l.maps_active and l.google_maps_url=new.google_maps_url collate "C")then return null;end if;
 end if;return new;end $$;
revoke all on function private.preserve_maps_original() from public,anon,authenticated;
