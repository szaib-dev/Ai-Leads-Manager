-- Phase 3. Narrow, owner-authorized transactional RPCs; no elevated application key.
alter table public.lead_pages add column deleted_at timestamptz;
alter table public.imports add column mode text not null default 'append' check(mode in ('append','replace','new'));
alter table public.imports add column request_id uuid not null default gen_random_uuid();
alter table public.imports add column batch_sequence bigint generated always as identity;
alter table public.imports add column replaced_count integer not null default 0 check(replaced_count>=0);
create unique index imports_request_unique on public.imports(owner_id,request_id);
create table public.import_members (
 owner_id uuid not null references auth.users(id) on delete cascade,
 import_id uuid not null,
 page_id uuid not null,
 lead_id uuid not null,
 role text not null check(role in ('inserted','replaced')),
 expected_updated_at timestamptz not null,
 expected_deleted_at timestamptz,
 primary key(import_id,lead_id),
 foreign key(import_id,page_id,owner_id) references public.imports(id,page_id,owner_id) on delete cascade,
 foreign key(lead_id,owner_id) references public.leads(id,owner_id) on delete cascade
);
alter table public.import_members enable row level security;
revoke all on public.import_members from public,anon,authenticated;
grant select on public.import_members to authenticated;
create policy owner_select on public.import_members for select to authenticated using(owner_id=(select auth.uid()));
create index import_members_lead_idx on public.import_members(owner_id,lead_id);
create extension if not exists pg_trgm with schema extensions;
create index leads_name_search_idx on public.leads using gin (business_name extensions.gin_trgm_ops) where deleted_at is null;
create index leads_phone_search_idx on public.leads using gin (phone extensions.gin_trgm_ops) where deleted_at is null;
create index leads_phone_normalized_search_idx on public.leads using gin ((regexp_replace(coalesce(phone,''),'[^0-9+]','','g')) extensions.gin_trgm_ops) where deleted_at is null;

create function private.phase3_owner() returns uuid language plpgsql stable set search_path='' as $$
declare u uuid=auth.uid();begin if u is null then raise exception 'Authentication required' using errcode='42501';end if;return u;end $$;

create function public.workspace_pages() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]') from (
 select p.id,p.name,p.description,p.created_at,
 count(l.id) filter(where l.archived_at is null)::integer as lead_count,
 count(l.id) filter(where l.archived_at is null and l.status='new')::integer as new_count,
 count(l.id) filter(where l.archived_at is null and l.last_contacted_at is not null)::integer as contacted_count
 from public.lead_pages p left join public.leads l on l.page_id=p.id and l.owner_id=p.owner_id and l.deleted_at is null
 where p.owner_id=(select auth.uid()) and p.deleted_at is null group by p.id) x
$$;

create function public.workspace_leads(p_page uuid default null,p_mode text default 'page',p_search text default '',p_status text default 'all',p_phone boolean default false,p_sort text default 'newest',p_offset integer default 0,p_limit integer default 8)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;begin
 if p_mode not in ('page','attempts','archive') or p_sort not in ('newest','name','attempts') or p_offset<0 or p_offset>1000000 or p_limit<1 or p_limit>100 or length(p_search)>200 then raise exception 'Invalid list parameters';end if;
 with eligible as (
 select l.* from public.leads l join public.lead_pages p on p.id=l.page_id and p.owner_id=l.owner_id
 where l.owner_id=(select auth.uid()) and l.deleted_at is null and p.deleted_at is null
 and (p_mode<>'page' or l.page_id=p_page)
 and (case when p_mode='archive' then l.archived_at is not null else l.archived_at is null end)
 and (p_mode<>'attempts' or l.status in ('no_answer','voicemail'))
 ), filtered as (
 select e.*,coalesce(a.total_attempts,0) as attempts,coalesce(a.failed_attempts,0) as failed_attempts
 from eligible e left join public.lead_attempt_summary a on a.lead_id=e.id and a.owner_id=e.owner_id
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

create function public.manage_page(p_id uuid,p_name text default null,p_description text default '',p_delete boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();target uuid;begin
 perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 if p_id is null then
  if p_delete then raise exception 'Page required';end if;
  if length(btrim(p_name)) not between 1 and 100 then raise exception 'Invalid page name';end if;
  insert into public.lead_pages(owner_id,name,description) values(u,btrim(p_name),p_description) returning id into target;
 else
  perform 1 from public.lead_pages where id=p_id and owner_id=u and deleted_at is null for update;
  if not found then raise exception 'Page unavailable' using errcode='42501';end if;
  if p_delete then update public.lead_pages set deleted_at=clock_timestamp() where id=p_id and owner_id=u;
  else
   if length(btrim(p_name)) not between 1 and 100 then raise exception 'Invalid page name';end if;
   update public.lead_pages set name=btrim(p_name),description=p_description where id=p_id and owner_id=u;
  end if;target=p_id;
 end if;return target;end $$;

create function public.save_lead(p_id uuid,p_expected timestamptz,p_data jsonb,p_action text default 'edit') returns void
language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();l public.leads%rowtype;begin
 perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 select * into l from public.leads where id=p_id and owner_id=u and deleted_at is null for update;
 if not found or not exists(select 1 from public.lead_pages where id=l.page_id and owner_id=u and deleted_at is null) then raise exception 'Lead unavailable' using errcode='42501';end if;
 if l.updated_at<>p_expected then raise exception 'Lead changed. Reload before saving.' using errcode='40001';end if;
 if p_action='delete' then update public.leads set deleted_at=clock_timestamp() where id=p_id and owner_id=u;
 elsif p_action='archive' then update public.leads set archived_at=clock_timestamp(),archive_reason='manual' where id=p_id and owner_id=u;
 elsif p_action='restore' then
  if l.status='not_interested' then raise exception 'Change rejected status explicitly before restoring; do-not-call suppression remains';end if;
  update public.leads set archived_at=null,archive_reason=null where id=p_id and owner_id=u;
 elsif p_action='edit' then
  if jsonb_typeof(p_data)<>'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('business_name','phone','website_url','country','location','notes','status')) then raise exception 'Invalid lead fields';end if;
  update public.leads set business_name=coalesce(p_data->>'business_name',business_name),phone=case when p_data?'phone' then nullif(p_data->>'phone','') else phone end,
   website_url=case when p_data?'website_url' then nullif(p_data->>'website_url','') else website_url end,
   country=case when p_data?'country' then nullif(p_data->>'country','') else country end,
   location=case when p_data?'location' then nullif(p_data->>'location','') else location end,
   notes=coalesce(p_data->>'notes',notes),status=coalesce((p_data->>'status')::public.lead_status,status) where id=p_id and owner_id=u;
 else raise exception 'Invalid action';end if;
end $$;

-- All rows are staged/validated by the server first; this transaction rechecks constraints.
create function public.commit_import(p_request uuid,p_page uuid,p_new_name text,p_mode text,p_file text,p_rows jsonb,p_total integer,p_invalid integer)
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
  on conflict(owner_id,google_maps_url) where google_maps_url is not null do nothing returning id into new_id;
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

create function public.undo_import(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();b public.imports%rowtype;begin
 perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 select * into b from public.imports where id=p_id and owner_id=u for update;
 if not found then raise exception 'Import unavailable' using errcode='42501';end if;
 if b.status='rolled_back' then return;end if;
 if b.status<>'completed' then raise exception 'Import not completed';end if;
 if not exists(select 1 from public.lead_pages where id=b.page_id and owner_id=u and deleted_at is null) then raise exception 'Page has been deleted';end if;
 if exists(select 1 from public.imports where page_id=b.page_id and owner_id=u and batch_sequence>b.batch_sequence and status='completed') then raise exception 'Undo newer imports on this page first';end if;
 perform 1 from public.leads where id in(select lead_id from public.import_members where import_id=b.id) for update;
 if (select count(*) from public.import_members where import_id=b.id and role='inserted')<>b.successful_rows or (select count(*) from public.import_members where import_id=b.id and role='replaced')<>b.replaced_count then raise exception 'Import records have changed; undo would lose data';end if;
 if exists(select 1 from public.import_members m join public.leads l on l.id=m.lead_id where m.import_id=b.id and (l.updated_at<>m.expected_updated_at or l.deleted_at is distinct from m.expected_deleted_at)) then raise exception 'Leads changed since import; undo blocked to protect your changes';end if;
 if exists(select 1 from public.import_members m where m.import_id=b.id and m.role='inserted' and (exists(select 1 from public.call_attempts where lead_id=m.lead_id) or exists(select 1 from public.followups where lead_id=m.lead_id))) then raise exception 'Imported leads have calling history or follow-ups; undo blocked';end if;
 delete from public.leads where id in(select lead_id from public.import_members where import_id=b.id and role='inserted');
 update public.leads set deleted_at=null where id in(select lead_id from public.import_members where import_id=b.id and role='replaced');
 -- Restoring an earlier import changes timestamps; update that earlier batch's safe baseline.
 update public.import_members m set expected_updated_at=l.updated_at,expected_deleted_at=l.deleted_at from public.leads l
 where m.lead_id=l.id and m.import_id<>b.id and l.id in(select lead_id from public.import_members where import_id=b.id and role='replaced');
 update public.imports set status='rolled_back' where id=b.id and owner_id=u;
end $$;

revoke all on function private.phase3_owner() from public,anon,authenticated;
create function public.preview_import(p_urls jsonb) returns integer language plpgsql stable security invoker set search_path='' as $$
declare result integer;begin
 if jsonb_typeof(p_urls)<>'array' or jsonb_array_length(p_urls)>10000 then raise exception 'Invalid preview';end if;
 with urls as(select value #>> '{}' as url from jsonb_array_elements(p_urls)), grouped as(select url,count(*) n from urls where url is not null and url<>'' group by url)
 select coalesce(sum(case when exists(select 1 from public.leads l where l.owner_id=(select auth.uid()) and l.google_maps_url=g.url collate "C") then n else n-1 end),0)::integer into result from grouped g;
 return result;end $$;
revoke all on function public.preview_import(jsonb) from public,anon,authenticated;
grant execute on function public.preview_import(jsonb) to authenticated;
revoke all on function public.workspace_pages(),public.workspace_leads(uuid,text,text,text,boolean,text,integer,integer),public.manage_page(uuid,text,text,boolean),public.save_lead(uuid,timestamptz,jsonb,text),public.commit_import(uuid,uuid,text,text,text,jsonb,integer,integer),public.undo_import(uuid) from public,anon,authenticated;
grant execute on function public.workspace_pages(),public.workspace_leads(uuid,text,text,text,boolean,text,integer,integer),public.manage_page(uuid,text,text,boolean),public.save_lead(uuid,timestamptz,jsonb,text),public.commit_import(uuid,uuid,text,text,text,jsonb,integer,integer),public.undo_import(uuid) to authenticated;
