create table public.lead_cities (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 country_id uuid not null, name text not null check(length(btrim(name)) between 1 and 100),
 created_at timestamptz not null default now(), unique(id,country_id,owner_id),
 foreign key(country_id,owner_id) references public.lead_countries(id,owner_id) on delete cascade
);
create unique index lead_cities_name on public.lead_cities(owner_id,country_id,lower(btrim(name)));
alter table public.lead_cities enable row level security;
revoke all on public.lead_cities from public,anon,authenticated;
grant select on public.lead_cities to authenticated;
create policy owner_select on public.lead_cities for select to authenticated using(owner_id=(select auth.uid()));
alter table public.lead_pages add column city_id uuid;
alter table public.lead_pages add foreign key(city_id,country_id,owner_id) references public.lead_cities(id,country_id,owner_id);
create index lead_pages_city on public.lead_pages(owner_id,city_id) where deleted_at is null;
create trigger workspace_signal after insert or update or delete on public.lead_cities for each row execute function private.signal_workspace_change();
-- Existing country operations clear a previous city when moving out of its country.
create function private.clear_page_city() returns trigger language plpgsql set search_path='' as $$begin
 if new.country_id is distinct from old.country_id and new.city_id is not distinct from old.city_id then new.city_id=null;end if;return new;end $$;
create trigger clear_page_city before update on public.lead_pages for each row execute function private.clear_page_city();
revoke all on function private.clear_page_city() from public,anon,authenticated;
create or replace function public.country_structure() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('countries',coalesce((select jsonb_agg(to_jsonb(c) order by lower(c.name),c.id) from public.lead_countries c where owner_id=auth.uid()),'[]'),
 'cities',coalesce((select jsonb_agg(to_jsonb(c) order by lower(c.name),c.id) from public.lead_cities c where owner_id=auth.uid()),'[]'),
 'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'country_id',country_id,'city_id',city_id)) from public.lead_pages where owner_id=auth.uid() and deleted_at is null),'[]'))
$$;
create function public.manage_city(p_id uuid,p_country uuid,p_name text,p_delete boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();r uuid;begin
 perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 if not exists(select 1 from public.lead_countries where id=p_country and owner_id=u) then raise exception 'Country unavailable';end if;
 if p_id is not null and not exists(select 1 from public.lead_cities where id=p_id and country_id=p_country and owner_id=u) then raise exception 'City unavailable';end if;
 if p_delete then update public.lead_pages set city_id=null where city_id=p_id and owner_id=u;delete from public.lead_cities where id=p_id and owner_id=u;return p_id;end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 100 then raise exception 'Choose a city name';end if;
 if p_id is null then insert into public.lead_cities(owner_id,country_id,name) values(u,p_country,btrim(p_name)) returning id into r;
 else update public.lead_cities set name=btrim(p_name) where id=p_id and owner_id=u returning id into r;end if;return r;end $$;
create function public.move_page_location(p_page uuid,p_country uuid,p_city uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();begin
 perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 if p_country is not null and not exists(select 1 from public.lead_countries where id=p_country and owner_id=u) then raise exception 'Country unavailable';end if;
 if p_city is not null and (p_country is null or not exists(select 1 from public.lead_cities where id=p_city and country_id=p_country and owner_id=u)) then raise exception 'Choose a city inside this country';end if;
 update public.lead_pages set country_id=p_country,city_id=p_city where id=p_page and owner_id=u and deleted_at is null;
 if not found then raise exception 'Page unavailable';end if;end $$;
create function public.create_location_page(p_name text,p_description text,p_country uuid,p_city uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare r uuid;begin r=public.manage_page(null,p_name,p_description,false);perform public.move_page_location(r,p_country,p_city);return r;end $$;
create function public.import_in_location(p_country uuid,p_city uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();r jsonb;done boolean;begin
 perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 if p_city is null or p_country is null or not exists(select 1 from public.lead_cities where id=p_city and country_id=p_country and owner_id=u) then raise exception 'Choose a city inside this country';end if;
 select exists(select 1 from public.imports where owner_id=u and request_id=(p_payload->>'p_request')::uuid) into done;
 if not done and p_payload->>'p_mode'<>'new' and not exists(select 1 from public.lead_pages where id=(p_payload->>'p_page')::uuid and country_id=p_country and city_id=p_city and owner_id=u and deleted_at is null) then raise exception 'Choose a page inside this city';end if;
 r=public.commit_import((p_payload->>'p_request')::uuid,(p_payload->>'p_page')::uuid,p_payload->>'p_new_name',p_payload->>'p_mode',p_payload->>'p_file',p_payload->'p_rows',(p_payload->>'p_total')::integer,(p_payload->>'p_invalid')::integer);
 if not done and p_payload->>'p_mode'='new' then perform public.move_page_location((r->>'pageId')::uuid,p_country,p_city);end if;return r;end $$;
revoke all on function public.manage_city(uuid,uuid,text,boolean),public.move_page_location(uuid,uuid,uuid),public.create_location_page(text,text,uuid,uuid),public.import_in_location(uuid,uuid,jsonb) from public,anon;
grant execute on function public.manage_city(uuid,uuid,text,boolean),public.move_page_location(uuid,uuid,uuid),public.create_location_page(text,text,uuid,uuid),public.import_in_location(uuid,uuid,jsonb) to authenticated;

-- Dedicated frozen folder plans do not modify lead records or their calling history.
create table private.page_location_plans (
 operation_id uuid primary key references public.operations(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 page_id uuid not null, expected_updated_at timestamptz not null, country_id uuid not null, city_id uuid not null,
 page_name text not null, destination text not null, expires_at timestamptz not null default(clock_timestamp()+interval '10 minutes')
);
revoke all on private.page_location_plans from public,anon,authenticated;
alter function public.ai_plan_result(uuid,integer) rename to ai_plan_result_before_cities;
revoke all on function public.ai_plan_result_before_cities(uuid,integer) from public,anon,authenticated;
create function public.ai_plan_result(p_id uuid,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid=private.phase3_owner();o public.operations;p private.page_location_plans;begin
 select * into o from public.operations where id=p_id and owner_id=u and source='ai';
 if o.ai_action is distinct from 'organize_page' then return public.ai_plan_result_before_cities(p_id,p_offset);end if;
 select * into p from private.page_location_plans where operation_id=p_id and owner_id=u;
 if p.operation_id is null or p_offset<>0 then raise exception 'Folder plan unavailable';end if;
 return jsonb_build_object('id',o.id,'action','organize_page','status',o.status,'mode','strict','count',1,'requiresApproval',true,'expiresAt',p.expires_at,'page',1,'totalPages',1,'rows','[]'::jsonb,'summary',case when o.status='completed' then 'Page moved. Leads and call history were kept.' else 'Move this complete lead page into the selected city folder. Its records and call history stay together.' end,'folderMove',jsonb_build_object('pageName',p.page_name,'destination',p.destination),'scope',jsonb_build_object('pageId',p.page_id));
end $$;
create function public.ai_stage_page_location(p_request uuid,p_page uuid,p_city uuid,p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();op uuid;lp public.lead_pages;city public.lead_cities;destination text;begin
 perform private.ai_proof(p_token);perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 select id into op from public.operations where owner_id=u and request_id=p_request;
 if found then return public.ai_plan_result(op);end if;
 select * into lp from public.lead_pages where id=p_page and owner_id=u and deleted_at is null for update;
 select * into city from public.lead_cities where id=p_city and owner_id=u;
 if p_request is null or lp.id is null or city.id is null then raise exception 'Page or city unavailable';end if;
 if lp.country_id is distinct from city.country_id then raise exception 'Choose a city in the same country as the source page';end if;
 select c.name||' / '||city.name into destination from public.lead_countries c where c.id=city.country_id and c.owner_id=u;
 insert into public.operations(owner_id,request_id,source,kind,permission_mode,target_page_id,ai_action,affected_count) values(u,p_request,'ai','lead_update','strict',lp.id,'organize_page',1) returning id into op;
 insert into private.page_location_plans(operation_id,owner_id,page_id,expected_updated_at,country_id,city_id,page_name,destination) values(op,u,lp.id,lp.updated_at,city.country_id,city.id,lp.name,destination);
 return public.ai_plan_result(op);end $$;
alter function public.ai_execute(uuid,boolean,text) rename to ai_execute_before_cities;
revoke all on function public.ai_execute_before_cities(uuid,boolean,text) from public,anon,authenticated;
create function public.ai_execute(p_id uuid,p_approved boolean,p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();o public.operations;p private.page_location_plans;lp public.lead_pages;begin
 perform private.ai_proof(p_token);perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 select * into o from public.operations where id=p_id and owner_id=u and source='ai' for update;
 if o.ai_action is distinct from 'organize_page' then return public.ai_execute_before_cities(p_id,p_approved,p_token);end if;
 if o.status='completed' then return public.ai_plan_result(p_id);end if;
 select * into p from private.page_location_plans where operation_id=p_id and owner_id=u;
 if p.operation_id is null or o.status<>'planned' or p.expires_at<clock_timestamp() then raise exception 'Folder plan expired or cancelled. Ask for a fresh preview.';end if;
 if p_approved is distinct from true then raise exception 'Review and approve the folder move first';end if;
 if not exists(select 1 from public.lead_cities city join public.lead_countries c on c.id=city.country_id and c.owner_id=u where city.id=p.city_id and city.owner_id=u and city.country_id=p.country_id and c.name||' / '||city.name=p.destination) then raise exception 'Destination changed. Ask for a fresh preview.';end if;
 select * into lp from public.lead_pages where id=p.page_id and owner_id=u and deleted_at is null for update;
 if lp.id is null or lp.updated_at is distinct from p.expected_updated_at then raise exception 'Page changed. Ask for a fresh preview.';end if;
 perform public.move_page_location(p.page_id,p.country_id,p.city_id);
 update public.operations set status='completed',finished_at=clock_timestamp() where id=p_id and owner_id=u;
 return public.ai_plan_result(p_id);end $$;
revoke all on function public.ai_plan_result(uuid,integer),public.ai_stage_page_location(uuid,uuid,uuid,text),public.ai_execute(uuid,boolean,text) from public,anon;
grant execute on function public.ai_plan_result(uuid,integer),public.ai_stage_page_location(uuid,uuid,uuid,text),public.ai_execute(uuid,boolean,text) to authenticated;

alter function public.ai_context(uuid,uuid[],uuid) rename to ai_context_before_cities;
revoke all on function public.ai_context_before_cities(uuid,uuid[],uuid) from public,anon,authenticated;
create function public.ai_context(p_page uuid default null,p_selected uuid[] default '{}',p_recent uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid=private.phase3_owner();base jsonb;begin
 base=public.ai_context_before_cities(p_page,p_selected,p_recent);
 return base||jsonb_build_object('cities',coalesce((select jsonb_agg(to_jsonb(c)) from(select lc.id,lc.name,lc.country_id,c.name country from public.lead_cities lc join public.lead_countries c on c.id=lc.country_id and c.owner_id=u where lc.owner_id=u order by lower(lc.name),lc.id limit 300)c),'[]'),
 'pages',coalesce((select jsonb_agg(e.value||jsonb_build_object('countryId',lp.country_id,'cityId',lp.city_id,'city',city.name)) from jsonb_array_elements(base->'pages') e join public.lead_pages lp on lp.id=(e.value->>'id')::uuid and lp.owner_id=u left join public.lead_cities city on city.id=lp.city_id and city.owner_id=u),'[]'));
end $$;
revoke all on function public.ai_context(uuid,uuid[],uuid) from public,anon;
grant execute on function public.ai_context(uuid,uuid[],uuid) to authenticated;
notify pgrst,'reload schema';
