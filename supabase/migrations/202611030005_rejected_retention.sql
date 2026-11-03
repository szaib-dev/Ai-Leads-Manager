-- Supabase Cron runs in PostgreSQL; no application secret or external worker is needed.
-- Native scratch PostgreSQL installations without pg_cron still test the purge function.
do $$begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('folio-rejected-retention','17 * * * *','select private.purge_rejected_leads(500)');
 else raise notice 'pg_cron unavailable: install on the hosted project to run automatic retention';end if;
end $$;
