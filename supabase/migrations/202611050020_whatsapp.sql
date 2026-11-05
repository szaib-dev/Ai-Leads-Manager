-- Manual messaging is a lead workflow, never a call_attempt.
alter table public.leads add column whatsapp_status text not null default 'Waiting for Reply'
 check (whatsapp_status in ('Waiting for Reply','In Conversation','Interested','Closed'));
alter table public.leads add column whatsapp_notes text not null default '';
alter table public.leads add column whatsapp_last_interaction date;
create index leads_whatsapp_queue on public.leads(owner_id,updated_at desc,id) where status='whatsapp' and deleted_at is null and archived_at is null;
create function public.manage_whatsapp(p_id uuid,p_expected timestamptz,p_status text,p_notes text,p_date date) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid;begin
 if p_status is null or p_status not in ('Waiting for Reply','In Conversation','Interested','Closed') or p_notes is null or octet_length(p_notes)>16000 then raise exception 'Invalid conversation details';end if;
 c=private.start_change(p_id,p_expected,'lead_edit',gen_random_uuid());
 if exists(select 1 from public.leads where id=p_id and (archived_at is not null or deleted_at is not null)) or public.is_lead_suppressed(p_id) then raise exception 'Archived or do-not-call lead';end if;
 perform private.route_lead(p_id,'whatsapp');
 update public.leads set whatsapp_status=p_status,whatsapp_notes=p_notes,whatsapp_last_interaction=p_date where id=p_id;
 perform private.finish_change(c);
end $$;
revoke all on function public.manage_whatsapp(uuid,timestamptz,text,text,date) from public,anon;
grant execute on function public.manage_whatsapp(uuid,timestamptz,text,text,date) to authenticated;
-- Repair publication membership without removing any unrelated publications/tables.
do $$begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime;end if;
 if not exists(select 1 from pg_publication where pubname='supabase_realtime' and puballtables) and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='workspace_sync') then alter publication supabase_realtime add table public.workspace_sync;end if;
end $$;
