-- Retain only owner-scoped hashes, never deleted names/phones, for review markers.
-- Exact Maps URL remains the primary identity; fallback highlights never deduplicate.
create or replace function private.reimport_identity(p_maps text,p_name text,p_phone text,p_website text)
returns bytea language sql immutable set search_path='' as $$
 select case when nullif(p_maps,'') is not null then sha256(convert_to(p_maps,'UTF8'))
 when nullif(btrim(p_name),'') is not null and length(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'))>=7
 then sha256(convert_to('phone-name:'||lower(btrim(p_name))||':'||regexp_replace(p_phone,'[^0-9]','','g'),'UTF8'))
 when nullif(btrim(p_name),'') is not null and nullif(btrim(p_website),'') is not null
 then sha256(convert_to('website-name:'||lower(btrim(p_name))||':'||lower(btrim(p_website)),'UTF8')) end
$$;
revoke all on function private.reimport_identity(text,text,text,text) from public,anon,authenticated;
insert into private.deleted_page_maps(owner_id,url_hash)
select distinct l.owner_id,private.reimport_identity(l.google_maps_url,l.business_name,l.phone,l.website_url)
from public.leads l join public.lead_pages p on p.id=l.page_id and p.owner_id=l.owner_id
where (l.deleted_at is not null or p.deleted_at is not null)
and private.reimport_identity(l.google_maps_url,l.business_name,l.phone,l.website_url) is not null
on conflict do nothing;
create or replace function private.reimport_marker() returns trigger language plpgsql security definer set search_path='' as $$
declare fingerprint bytea;begin
 new.maps_active=new.deleted_at is null and exists(select 1 from public.lead_pages p where p.id=new.page_id and p.owner_id=new.owner_id and p.deleted_at is null);
 if tg_op='UPDATE' then
   if old.deleted_at is null and new.deleted_at is not null then
     fingerprint=private.reimport_identity(old.google_maps_url,old.business_name,old.phone,old.website_url);
     if fingerprint is not null then insert into private.deleted_page_maps(owner_id,url_hash) values(old.owner_id,fingerprint) on conflict do nothing;end if;
   end if;
 elsif tg_op='INSERT' then
   fingerprint=private.reimport_identity(new.google_maps_url,new.business_name,new.phone,new.website_url);
   new.previously_imported=fingerprint is not null and exists(select 1 from private.deleted_page_maps where owner_id=new.owner_id and url_hash=fingerprint);
 end if;
 return new;
end $$;
-- Page deletion also remembers fallback identities for CSVs without Maps URLs.
create or replace function private.deleted_page_identifiers() returns trigger language plpgsql security definer set search_path='' as $$begin
 if old.deleted_at is null and new.deleted_at is not null then
  perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||new.owner_id::text,0));
  insert into private.deleted_page_maps(owner_id,url_hash)
  select owner_id,private.reimport_identity(google_maps_url,business_name,phone,website_url) from public.leads
  where page_id=new.id and owner_id=new.owner_id and private.reimport_identity(google_maps_url,business_name,phone,website_url) is not null on conflict do nothing;
  update public.leads set maps_active=false where page_id=new.id and owner_id=new.owner_id;
 elsif old.deleted_at is not null and new.deleted_at is null then
  update public.leads set maps_active=deleted_at is null where page_id=new.id and owner_id=new.owner_id;
 end if;return new;end $$;
notify pgrst, 'reload schema';
