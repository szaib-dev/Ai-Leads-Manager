create or replace function public.record_call(p_lead uuid,p_expected timestamptz,p_request uuid,p_outcome public.call_outcome,p_notes text default '',p_date date default null,p_time time default null,p_followup uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid;a uuid;begin
 if p_outcome<>'awaiting_callback' then
 if exists(select 1 from public.workflow_changes where owner_id=auth.uid() and request_id=p_request and after_updated_at is not null) then return public.record_call_before_callbacks(p_lead,p_expected,p_request,p_outcome,p_notes,p_date,p_time,p_followup);end if;
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
create or replace function public.manage_callback(p_id uuid,p_expected timestamptz,p_request uuid,p_action text,p_date date default null,p_time time default null,p_notes text default '',p_reminder timestamptz default null) returns uuid language plpgsql security definer set search_path='' as $$
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
 update public.awaiting_callbacks set completed_at=clock_timestamp(),resolution=p_action,notes=coalesce(p_notes,''),updated_at=clock_timestamp() where id=p_id;
 perform private.route_lead(r.lead_id,case p_action when 'not_interested' then 'not_interested'::public.lead_status when 'follow_up_myself' then 'follow_up'::public.lead_status else 'interested'::public.lead_status end);
 if p_action='follow_up_myself' then perform private.schedule_followup(r.lead_id,p_date,p_time,p_notes);end if;
 end if;
 perform private.finish_change(c);return c;end $$;

create function private.route_callback() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.status<>'awaiting_callback' or new.archived_at is not null or new.deleted_at is not null then
 update public.awaiting_callbacks set completed_at=clock_timestamp(),resolution='cancelled',updated_at=clock_timestamp() where lead_id=new.id and completed_at is null;
 end if;return new;end $$;
create trigger route_callback after update of status,archived_at,deleted_at on public.leads for each row execute function private.route_callback();
revoke all on function private.route_callback() from public,anon,authenticated;
