-- ONLY for a fresh disposable PostgreSQL database. Not a Supabase migration.
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth,public to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;

create schema realtime;
create table realtime.messages(id bigint generated always as identity,extension text,topic text,payload jsonb);
alter table realtime.messages enable row level security;
grant usage on schema realtime to authenticated;
grant select on realtime.messages to authenticated;
create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
create function realtime.send(payload jsonb,event text,topic text,private boolean default true) returns void language sql as $$insert into realtime.messages(extension,topic,payload) values('broadcast',topic,payload)$$;
