-- Ordinary edits refresh bounded queries; only physical deletion invalidates private drafts.
alter table public.workspace_sync add column privacy_revision bigint not null default 0;
alter table public.workspace_sync add column privacy_transaction bigint not null default 0;
create or replace function private.signal_workspace_change() returns trigger language plpgsql security definer set search_path='' as $$
declare u uuid;purged boolean=tg_table_name='leads' and tg_op='DELETE';begin
 if tg_op='DELETE' then u=old.owner_id;else u=new.owner_id;end if;
 if exists(select 1 from auth.users where id=u) then
  insert into public.workspace_sync(owner_id,last_transaction,privacy_revision,privacy_transaction)
  values(u,txid_current(),case when purged then 1 else 0 end,case when purged then txid_current() else 0 end)
  on conflict(owner_id) do update set
   revision=public.workspace_sync.revision+case when public.workspace_sync.last_transaction<>excluded.last_transaction then 1 else 0 end,
   last_transaction=excluded.last_transaction,updated_at=clock_timestamp(),
   privacy_revision=public.workspace_sync.privacy_revision+case when purged and public.workspace_sync.privacy_transaction<>txid_current() then 1 else 0 end,
   privacy_transaction=case when purged then txid_current() else public.workspace_sync.privacy_transaction end
  where public.workspace_sync.last_transaction<>excluded.last_transaction or (purged and public.workspace_sync.privacy_transaction<>txid_current());
 end if;
 return null;
end $$;
revoke all on function private.signal_workspace_change() from public,anon,authenticated;
