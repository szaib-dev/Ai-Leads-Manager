-- Calling history is a projection of actual attempts; the complete audit log remains intact.
create function public.calling_history_range(p_from date,p_to date,p_timezone text default 'Asia/Karachi',p_page uuid default null,p_offset integer default 0,p_limit integer default 20) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;report jsonb;begin
 if p_offset<0 or p_offset>1000000 or p_limit not between 1 and 100 then raise exception 'Invalid pagination';end if;
 report=public.analytics_report(p_from,p_to,p_timezone,p_page);
 with events as(select e.id,e.lead_id,e.kind,e.occurred_at,e.outcome,e.from_status,e.to_status,e.voided_at,e.attempt_number,coalesce(l.business_name,'Removed business') business_name,coalesce(a.notes,'') notes,coalesce(l.location,'') location from public.activity_events e left join public.leads l on l.id=e.lead_id and l.owner_id=e.owner_id left join public.call_attempts a on a.id=e.attempt_id and a.owner_id=e.owner_id where e.kind='call_attempt' and e.owner_id=auth.uid() and e.occurred_at>=(report->>'start_at')::timestamptz and e.occurred_at<(report->>'end_at')::timestamptz and (p_page is null or e.page_id=p_page)),
 paged as(select * from events order by occurred_at desc,id desc limit p_limit offset p_offset)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'),'total',(select count(*) from events),'summary',report->'summary') into result;
 return result;end $$;

revoke all on function public.calling_history_range(date,date,text,uuid,integer,integer) from public,anon;
grant execute on function public.calling_history_range(date,date,text,uuid,integer,integer) to authenticated;

-- No CSV samples, provider credentials, or business details are stored in the budget ledger.
-- A server-only proof prevents browser clients from forging free token settlements.
create table private.ai_runtime (
 singleton boolean primary key default true check(singleton),
 server_token_hash bytea,
 model text not null default 'deepseek-flash' check(model='deepseek-flash'),
 input_rate numeric not null default 0.30 check(input_rate>0),
 output_rate numeric not null default 1.20 check(output_rate>0),
 pricing_verified date not null default '2026-11-03',
 monthly_budget numeric not null default 1.75 check(monthly_budget>0 and monthly_budget<=2)
);
insert into private.ai_runtime(singleton) values(true);
create table private.ai_usage (
 id uuid primary key,
 owner_id uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default clock_timestamp(),
 reserved_usd numeric not null check(reserved_usd>0),
 estimated_usd numeric check(estimated_usd>=0),
 input_tokens integer check(input_tokens>=0),output_tokens integer check(output_tokens>=0),
 input_rate numeric not null,output_rate numeric not null,
 settled_at timestamptz
);
create index ai_usage_month on private.ai_usage(created_at);
create index ai_usage_owner on private.ai_usage(owner_id,created_at);
revoke all on private.ai_runtime,private.ai_usage from public,anon,authenticated;
create function public.ai_csv_reserve(p_request uuid,p_input_bound integer,p_server_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg private.ai_runtime;used numeric;cost numeric;begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select * into cfg from private.ai_runtime where singleton for update;
 if p_server_token is null or cfg.server_token_hash is null or cfg.server_token_hash<>pg_catalog.sha256(pg_catalog.convert_to(p_server_token,'UTF8')) then raise exception 'AI server configuration is unavailable';end if;
 if cfg.pricing_verified<current_date-30 or cfg.pricing_verified>current_date then raise exception 'Review current provider pricing before enabling AI';end if;
 if p_request is null or p_input_bound not between 1 and 64000 then raise exception 'Invalid AI request';end if;
 if exists(select 1 from private.ai_usage where id=p_request) then raise exception 'This AI request was already submitted';end if;
 if (select count(*) from private.ai_usage where owner_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=6 then raise exception 'Please wait before requesting more AI suggestions';end if;
 select coalesce(sum(coalesce(estimated_usd,reserved_usd)),0) into used from private.ai_usage where created_at>=date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
 -- Input bound uses UTF-8 bytes plus protocol allowance: conservative, no cache discount.
 cost=(p_input_bound*cfg.input_rate+512*cfg.output_rate)/1000000;
 if used+cost>cfg.monthly_budget then raise exception 'Monthly AI budget exhausted';end if;
 insert into private.ai_usage(id,owner_id,reserved_usd,input_rate,output_rate) values(p_request,auth.uid(),cost,cfg.input_rate,cfg.output_rate);
 return jsonb_build_object('model',cfg.model,'reserved',cost,'remaining',cfg.monthly_budget-used-cost);
end $$;
create function public.ai_csv_settle(p_request uuid,p_input integer,p_output integer,p_server_token text) returns void language plpgsql security definer set search_path='' as $$
declare cfg private.ai_runtime;begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select * into cfg from private.ai_runtime where singleton for update;
 if p_server_token is null or cfg.server_token_hash is null or cfg.server_token_hash<>pg_catalog.sha256(pg_catalog.convert_to(p_server_token,'UTF8')) then raise exception 'Invalid AI server proof';end if;
 if p_input is not null and (p_input<0 or p_input>1000000 or p_output is null or p_output<0 or p_output>512) then raise exception 'Invalid usage';end if;
 -- An unknown/failed response keeps the full reservation charged conservatively.
 update private.ai_usage set input_tokens=p_input,output_tokens=p_output,estimated_usd=case when p_input is null then reserved_usd else (p_input*input_rate+p_output*output_rate)/1000000 end,settled_at=clock_timestamp() where id=p_request and owner_id=auth.uid() and settled_at is null;
 if not found and not exists(select 1 from private.ai_usage where id=p_request and owner_id=auth.uid() and settled_at is not null) then raise exception 'AI request not found';end if;
end $$;
create function public.ai_csv_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select jsonb_build_object('configured',c.server_token_hash is not null,'budget',c.monthly_budget,'estimated_spent',coalesce(sum(coalesce(u.estimated_usd,u.reserved_usd)),0),'pricing_verified',c.pricing_verified,'model',c.model) into result from private.ai_runtime c left join private.ai_usage u on u.created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC' group by c.singleton;
 return result;
end $$;
revoke all on function public.ai_csv_reserve(uuid,integer,text),public.ai_csv_settle(uuid,integer,integer,text),public.ai_csv_status() from public,anon;
grant execute on function public.ai_csv_reserve(uuid,integer,text),public.ai_csv_settle(uuid,integer,integer,text),public.ai_csv_status() to authenticated;
