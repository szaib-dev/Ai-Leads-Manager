-- Optional committed metadata patches. Existing owner-scoped revisions remain authoritative recovery.
create policy folio_owner_lead_patches on realtime.messages for select to authenticated
using (extension='broadcast' and topic='lead-patches:'||(select auth.uid())::text and (select realtime.topic())='lead-patches:'||(select auth.uid())::text);
-- Restrict our topic namespace even if unrelated permissive policies already exist.
create policy folio_patch_namespace on realtime.messages as restrictive for select to authenticated
using (topic not like 'lead-patches:%' or (topic='lead-patches:'||(select auth.uid())::text and topic=(select realtime.topic())));
create function private.broadcast_lead_patch() returns trigger language plpgsql security definer set search_path='' as $$
declare sent integer=coalesce(nullif(current_setting('folio.patch_count',true),''),'0')::integer;
begin
 if new.status is not distinct from old.status and new.archived_at is not distinct from old.archived_at and new.deleted_at is not distinct from old.deleted_at then return null;end if;
 -- Bound fanout during large bulk transactions; revision reconciliation covers the rest.
 if sent>=20 then return null;end if;
 perform set_config('folio.patch_count',(sent+1)::text,true);
 perform realtime.send(jsonb_build_object('owner_id',new.owner_id,'id',new.id,'status',new.status,'updated_at',new.updated_at,'archived',new.archived_at is not null,'deleted',new.deleted_at is not null),'lead-change','lead-patches:'||new.owner_id::text,true);
 return null;
exception when others then
 -- An optional transport failure must never fail an otherwise valid lead mutation.
 return null;
end $$;
revoke all on function private.broadcast_lead_patch() from public,anon,authenticated;
create trigger folio_lead_patch after update on public.leads for each row execute function private.broadcast_lead_patch();
