-- Disposable database only: capture effective permissions BEFORE the migration.
create function public.oauth_legacy_canary() returns int language sql as $$select 1$$;
create table private.oauth_acl_baseline as
select p.oid, r.rolname, has_function_privilege(r.rolname,p.oid,'execute') allowed
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join pg_roles r where n.nspname='public' and r.rolname in('anon','authenticated','service_role');
