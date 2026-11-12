create or replace function public.workspace_leads(p_page uuid default null,p_mode text default 'page',p_search text default '',p_status text default 'all',p_phone boolean default false,p_sort text default 'newest',p_offset integer default 0,p_limit integer default 8)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;begin
 if p_mode not in ('page','attempts','archive','callbacks','search') or p_sort not in ('newest','name','attempts') or p_offset<0 or p_offset>1000000 or p_limit<1 or p_limit>100 or length(p_search)>200 then raise exception 'Invalid list parameters';end if;
 with eligible as (
 select l.* from public.leads l join public.lead_pages p on p.id=l.page_id and p.owner_id=l.owner_id
 where l.owner_id=(select auth.uid()) and l.deleted_at is null and p.deleted_at is null
 and (p_mode<>'page' or (l.page_id=p_page and l.status <> 'not_interested'))
 and (p_mode='search' or case when p_mode='archive' then l.archived_at is not null else l.archived_at is null end)
 and (p_mode<>'attempts' or l.status in ('no_answer','voicemail'))
 and (p_mode<>'callbacks' or l.status='awaiting_callback')
 ), filtered as (
 select e.*,coalesce(a.total_attempts,0) as attempts,coalesce(a.consecutive_failed_attempts,0) as failed_attempts,a.last_attempt_at,(select notes from public.call_attempts ca where ca.lead_id=e.id and ca.owner_id=e.owner_id and ca.voided_at is null order by occurred_at desc,id desc limit 1) as last_attempt_notes,public.is_lead_suppressed(e.id) as suppressed,f.scheduled_date as followup,f.scheduled_time as followup_time
 from eligible e left join public.lead_attempt_summary a on a.lead_id=e.id and a.owner_id=e.owner_id
 left join public.followups f on f.owner_id=e.owner_id and f.lead_id=e.id and f.completed_at is null and f.cancelled_at is null
 where (p_status='all' or e.status::text=p_status or (p_mode='attempts' and p_status='attempt_'||coalesce(a.consecutive_failed_attempts,0)::text)) and (not p_phone or nullif(btrim(e.phone),'') is not null)
 and (p_search='' or e.business_name ilike '%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%'
 or e.phone ilike '%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%'
 or public.phone_search_match(e.phone,p_search))
 ), paged as (
 select * from filtered order by case when p_search<>'' and public.phone_search_match(phone,p_search) then 0 else 1 end, case when p_sort='name' then lower(business_name) end asc,
 case when p_sort='attempts' then attempts end desc,created_at desc,id limit p_limit offset p_offset
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'),
 'total',(select count(*) from filtered),'summary',jsonb_build_object('total',(select count(*) from eligible),
 'ready',(select count(*) from eligible where status='new' and nullif(btrim(phone),'') is not null),
 'contacted',(select count(*) from eligible where last_contacted_at is not null),
 'unanswered',(select count(*) from eligible where status='no_answer'))) into result;
 return result;end $$;



notify pgrst, 'reload schema';

create or replace function public.manage_country(p_id uuid,p_name text,p_delete boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner(); result uuid;begin
 perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||u::text,0));
 if p_id is not null and not exists(select 1 from public.lead_countries where id=p_id and owner_id=u) then raise exception 'Country unavailable';end if;
 if p_delete then
 -- Country deletion only unassigns pages; leads, pages and history are retained.
 update public.lead_pages set country_id=null where owner_id=u and country_id=p_id;
 delete from public.lead_countries where id=p_id and owner_id=u;return p_id;
 end if;
 if lower(btrim(p_name)) <> all(array['pakistan','usa','canada','uk','albania','andorra','austria','belgium','bosnia and herzegovina','bulgaria','croatia','cyprus','czechia','denmark','estonia','finland','france','germany','greece','hungary','iceland','india','ireland','italy','latvia','liechtenstein','lithuania','luxembourg','malta','moldova','monaco','montenegro','netherlands','north macedonia','norway','poland','portugal','romania','san marino','serbia','slovakia','slovenia','spain','sri lanka','sweden','switzerland','ukraine','vatican city','united states','united states of america','united kingdom','great britain','england','us']) then raise exception 'Choose a country from the supported list';end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 100 then raise exception 'Choose a country name';end if;
 if p_id is null then insert into public.lead_countries(owner_id,name) values(u,btrim(p_name)) returning id into result;
 else update public.lead_countries set name=btrim(p_name) where id=p_id and owner_id=u returning id into result;end if;
 return result;end $$;

notify pgrst, 'reload schema';
