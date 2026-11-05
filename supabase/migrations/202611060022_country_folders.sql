create table public.lead_countries (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 100), created_at timestamptz not null default now(), unique(id,owner_id));
create unique index lead_countries_owner_name on public.lead_countries(owner_id,lower(btrim(name)));
alter table public.lead_countries enable row level security;
revoke all on public.lead_countries from public,anon,authenticated;
grant select on public.lead_countries to authenticated;
create policy owner_select on public.lead_countries for select to authenticated using(owner_id=(select auth.uid()));
alter table public.lead_pages add column country_id uuid;
alter table public.lead_pages add foreign key(country_id,owner_id) references public.lead_countries(id,owner_id);
create index lead_pages_country on public.lead_pages(owner_id,country_id) where deleted_at is null;
create trigger workspace_signal after insert or update or delete on public.lead_countries for each row execute function private.signal_workspace_change();
create function public.country_structure() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('countries',coalesce((select jsonb_agg(to_jsonb(c) order by lower(c.name),c.id) from public.lead_countries c where owner_id=auth.uid()),'[]'),
 'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'country_id',country_id)) from public.lead_pages where owner_id=auth.uid() and deleted_at is null),'[]'))
$$;
create function public.manage_country(p_id uuid,p_name text,p_delete boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner(); result uuid;begin
 perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 if p_id is not null and not exists(select 1 from public.lead_countries where id=p_id and owner_id=u) then raise exception 'Country unavailable';end if;
 if p_delete then
 -- Country deletion only unassigns pages; leads, pages and history are retained.
 update public.lead_pages set country_id=null where owner_id=u and country_id=p_id;
 delete from public.lead_countries where id=p_id and owner_id=u;return p_id;
 end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 100 then raise exception 'Choose a country name';end if;
 if p_id is null then insert into public.lead_countries(owner_id,name) values(u,btrim(p_name)) returning id into result;
 else update public.lead_countries set name=btrim(p_name) where id=p_id and owner_id=u returning id into result;end if;
 return result;end $$;
create function public.move_country_page(p_page uuid,p_country uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();begin
 perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 if p_country is not null and not exists(select 1 from public.lead_countries where id=p_country and owner_id=u) then raise exception 'Country unavailable';end if;
 update public.lead_pages set country_id=p_country where id=p_page and owner_id=u and deleted_at is null;
 if not found then raise exception 'Page unavailable';end if;
end $$;
create function public.create_country_page(p_name text,p_description text,p_country uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;begin
 result=public.manage_page(null,p_name,p_description,false);
 perform public.move_country_page(result,p_country);return result;
end $$;
revoke all on function public.country_structure(),public.manage_country(uuid,text,boolean),public.move_country_page(uuid,uuid),public.create_country_page(text,text,uuid) from public,anon;
grant execute on function public.country_structure(),public.manage_country(uuid,text,boolean),public.move_country_page(uuid,uuid),public.create_country_page(text,text,uuid) to authenticated;
notify pgrst,'reload schema';

-- The import and country assignment commit together. Retrying a completed batch never moves it again.
create function public.import_in_country(p_country uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();r jsonb;already_done boolean;begin
 perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 if not exists(select 1 from public.lead_countries where id=p_country and owner_id=u) then raise exception 'Country unavailable';end if;
 select exists(select 1 from public.imports where owner_id=u and request_id=(p_payload->>'p_request')::uuid) into already_done;
 if not already_done and p_payload->>'p_mode'<>'new' and not exists(select 1 from public.lead_pages where owner_id=u and id=(p_payload->>'p_page')::uuid and country_id=p_country) then raise exception 'Choose a page inside this country';end if;
 r=public.commit_import((p_payload->>'p_request')::uuid,(p_payload->>'p_page')::uuid,p_payload->>'p_new_name',p_payload->>'p_mode',p_payload->>'p_file',p_payload->'p_rows',(p_payload->>'p_total')::integer,(p_payload->>'p_invalid')::integer);
 if not already_done and p_payload->>'p_mode'='new' then perform public.move_country_page((r->>'pageId')::uuid,p_country);end if;
 return r;
end $$;
revoke all on function public.import_in_country(uuid,jsonb) from public,anon;
grant execute on function public.import_in_country(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
