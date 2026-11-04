-- Repair installations which deployed chat code before its artifact migration; preserve messages.
alter table public.ai_chat_messages add column if not exists artifact jsonb;
notify pgrst, 'reload schema';
-- Only live records on live pages reserve exact Maps identifiers. History remains intact.
drop index public.leads_owner_maps_url_unique;
create unique index leads_owner_maps_url_unique on public.leads(owner_id,google_maps_url) where google_maps_url is not null and maps_active and deleted_at is null;
create or replace function private.reimport_marker() returns trigger language plpgsql security definer set search_path='' as $$begin
 new.maps_active=new.deleted_at is null and exists(select 1 from public.lead_pages p where p.id=new.page_id and p.owner_id=new.owner_id and p.deleted_at is null);
 if tg_op='INSERT' then new.previously_imported=new.google_maps_url is not null and exists(select 1 from private.deleted_page_maps where owner_id=new.owner_id and url_hash=sha256(convert_to(new.google_maps_url,'UTF8')));end if;return new;end $$;
update public.leads l set maps_active=l.deleted_at is null and exists(select 1 from public.lead_pages p where p.id=l.page_id and p.deleted_at is null);
create or replace function private.preserve_maps_original() returns trigger language plpgsql volatile security definer set search_path='' as $$begin
 if new.google_maps_url is not null then
 perform pg_advisory_xact_lock(hashtextextended('folio:maps:'||new.owner_id::text,0));
 if exists(select 1 from public.leads l join public.lead_pages p on p.id=l.page_id where l.owner_id=new.owner_id and p.deleted_at is null and l.deleted_at is null and l.maps_active and l.google_maps_url=new.google_maps_url collate "C") then return null;end if;
 end if;return new;end $$;
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
  on conflict(owner_id,google_maps_url) where google_maps_url is not null and maps_active and deleted_at is null do nothing returning id into new_id;
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

create function public.import_row_classifications(p_urls jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid=private.phase3_owner();begin
 if jsonb_typeof(p_urls)<>'array' or jsonb_array_length(p_urls)>10000 then raise exception 'Invalid preview';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object(
 'index',n-1,
 'active',exists(select 1 from public.leads l join public.lead_pages p on p.id=l.page_id where l.owner_id=u and l.deleted_at is null and p.deleted_at is null and l.google_maps_url=(x #>> '{}')),
 'previous',exists(select 1 from private.deleted_page_maps d where d.owner_id=u and d.url_hash=sha256(convert_to(x #>> '{}','UTF8')))
 )), '[]'::jsonb) from jsonb_array_elements(p_urls) with ordinality t(x,n));
end $$;
revoke all on function public.import_row_classifications(jsonb) from public,anon;
grant execute on function public.import_row_classifications(jsonb) to authenticated;
create or replace function public.preview_import(p_urls jsonb) returns integer language plpgsql stable security definer set search_path='' as $$begin
 return (select count(*)::int from jsonb_array_elements(public.import_row_classifications(p_urls)) x where (x->>'active')::boolean);end $$;

-- Promised inbound calls are separate from outbound follow-ups. Overdue is computed, never an attempt.
create table public.awaiting_callbacks (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 lead_id uuid not null, expected_date date, expected_time time, notes text not null default '' check(octet_length(notes)<=16000),
 reminder_at timestamptz, completed_at timestamptz, resolution text check(resolution in('called_back','follow_up_myself','not_interested','cancelled')),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 foreign key(lead_id,owner_id) references public.leads(id,owner_id) on delete cascade,
 check(expected_time is null or expected_date is not null));
create unique index one_waiting_callback on public.awaiting_callbacks(lead_id) where completed_at is null;
alter table public.awaiting_callbacks enable row level security;
revoke all on public.awaiting_callbacks from public,anon,authenticated;
grant select on public.awaiting_callbacks to authenticated;
create policy owner_select on public.awaiting_callbacks for select to authenticated using(owner_id=(select auth.uid()));
create trigger workspace_signal after insert or update or delete on public.awaiting_callbacks for each row execute function private.signal_workspace_change();
alter table public.workflow_changes add column callback_before jsonb;
create function private.callback_snapshot() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='INSERT' then
 new.callback_before=(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.awaiting_callbacks c where c.lead_id=new.lead_id);
 elsif old.undone_at is null and new.undone_at is not null then
 delete from public.awaiting_callbacks where lead_id=new.lead_id;
 insert into public.awaiting_callbacks select * from jsonb_populate_recordset(null::public.awaiting_callbacks,coalesce(old.callback_before,'[]'));
 end if;return new;end $$;
create trigger callback_snapshot before insert or update of undone_at on public.workflow_changes for each row execute function private.callback_snapshot();
alter function public.record_call(uuid,timestamptz,uuid,public.call_outcome,text,date,time,uuid) rename to record_call_before_callbacks;
revoke all on function public.record_call_before_callbacks(uuid,timestamptz,uuid,public.call_outcome,text,date,time,uuid) from public,anon,authenticated;
create function public.record_call(p_lead uuid,p_expected timestamptz,p_request uuid,p_outcome public.call_outcome,p_notes text default '',p_date date default null,p_time time default null,p_followup uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid;a uuid;begin
 if p_outcome<>'awaiting_callback' then
 c=public.record_call_before_callbacks(p_lead,p_expected,p_request,p_outcome,p_notes,p_date,p_time,p_followup);
 update public.awaiting_callbacks set completed_at=clock_timestamp(),resolution='cancelled',updated_at=clock_timestamp() where lead_id=p_lead and completed_at is null;
 return c;end if;
 c=private.start_change(p_lead,p_expected,'attempt',p_request);
 if (select after_updated_at is not null from public.workflow_changes where id=c) then return c;end if;
 if octet_length(p_notes)>16000 or (p_time is not null and p_date is null) then raise exception 'Check callback date and notes';end if;
 if exists(select 1 from public.leads where id=p_lead and archived_at is not null) or public.is_lead_suppressed(p_lead) then raise exception 'Do-not-call or archived lead: outreach is blocked';end if;
 insert into public.call_attempts(owner_id,lead_id,request_id,outcome,notes) values(auth.uid(),p_lead,p_request,p_outcome,coalesce(p_notes,'')) returning id into a;
 update public.workflow_changes set attempt_id=a where id=c;
 perform private.route_lead(p_lead,'awaiting_callback');
 insert into public.awaiting_callbacks(owner_id,lead_id,expected_date,expected_time,notes) values(auth.uid(),p_lead,p_date,p_time,coalesce(p_notes,''))
 on conflict(lead_id) where completed_at is null do update set expected_date=excluded.expected_date,expected_time=excluded.expected_time,notes=excluded.notes,updated_at=clock_timestamp();
 perform private.finish_change(c);return c;end $$;
create function public.manage_callback(p_id uuid,p_expected timestamptz,p_request uuid,p_action text,p_date date default null,p_time time default null,p_notes text default '',p_reminder timestamptz default null) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid=private.phase3_owner();r public.awaiting_callbacks%rowtype;c uuid;begin
 select * into r from public.awaiting_callbacks where id=p_id and owner_id=u;
 if not found then raise exception 'Callback unavailable';end if;
 c=private.start_change(r.lead_id,p_expected,'lead_edit',p_request);
 if (select after_updated_at is not null from public.workflow_changes where id=c) then return c;end if;
 select * into r from public.awaiting_callbacks where id=p_id and owner_id=u for update;
 if r.completed_at is not null or p_action not in('reschedule','called_back','follow_up_myself','not_interested') or p_action is null or octet_length(p_notes)>16000 or (p_time is not null and p_date is null) then raise exception 'Callback changed or invalid action';end if;
 if p_action='reschedule' then
 update public.awaiting_callbacks set expected_date=p_date,expected_time=p_time,notes=coalesce(p_notes,''),reminder_at=p_reminder,updated_at=clock_timestamp() where id=p_id;
 update public.leads set updated_at=clock_timestamp() where id=r.lead_id;
 else
 update public.awaiting_callbacks set completed_at=clock_timestamp(),resolution=p_action,updated_at=clock_timestamp() where id=p_id;
 perform private.route_lead(r.lead_id,case p_action when 'not_interested' then 'not_interested'::public.lead_status when 'follow_up_myself' then 'follow_up'::public.lead_status else 'interested'::public.lead_status end);
 if p_action='follow_up_myself' then perform private.schedule_followup(r.lead_id,p_date,p_time,p_notes);end if;
 end if;
 perform private.finish_change(c);return c;end $$;
create function public.workspace_callbacks(p_day date,p_time time,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid=private.phase3_owner();begin
 if p_day is null or p_time is null or p_offset<0 then raise exception 'Invalid callback query';end if;
 return (with eligible as(select c.*,l.page_id,l.business_name,l.phone,l.updated_at lead_updated_at,
 case when c.completed_at is not null then 'Completed' when c.expected_date<p_day or (c.expected_date=p_day and c.expected_time is not null and c.expected_time<p_time) then 'Overdue' else 'Waiting' end status
 from public.awaiting_callbacks c join public.leads l on l.id=c.lead_id join public.lead_pages p on p.id=l.page_id
 where c.owner_id=u and l.deleted_at is null and p.deleted_at is null),paged as(select * from eligible order by completed_at nulls first,expected_date nulls last,id limit 20 offset p_offset)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'),'total',(select count(*) from eligible)));
end $$;
revoke all on function public.record_call(uuid,timestamptz,uuid,public.call_outcome,text,date,time,uuid),public.manage_callback(uuid,timestamptz,uuid,text,date,time,text,timestamptz),public.workspace_callbacks(date,time,integer),private.callback_snapshot() from public,anon,authenticated;
grant execute on function public.record_call(uuid,timestamptz,uuid,public.call_outcome,text,date,time,uuid),public.manage_callback(uuid,timestamptz,uuid,text,date,time,text,timestamptz),public.workspace_callbacks(date,time,integer) to authenticated;

-- Clear callback snapshots with the existing retention scrub, including on account cascades.
create function private.clear_callback_snapshot() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.before_data is null then new.callback_before=null;end if;return new;end $$;
create trigger clear_callback_snapshot before update of before_data on public.workflow_changes for each row execute function private.clear_callback_snapshot();
revoke all on function private.clear_callback_snapshot() from public,anon,authenticated;
