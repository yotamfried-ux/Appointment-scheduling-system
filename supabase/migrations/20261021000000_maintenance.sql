-- Stage 11: housekeeping with explicit retention (docs/05 §14.4) and a heartbeat view for monitoring (OPS-05/06). System path only (service_role).
-- Nothing here touches business data: customers, appointments, audit rows and billing history are never deleted by a job.

create function private.maintenance_impl(p_now timestamptz default now()) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rate int; v_idem int; v_tokens int; v_jobs int; v_events int;
begin
  delete from public.rate_counters where window_start < p_now - interval '1 day';                          -- counters older than a day can never block anyone
  get diagnostics v_rate = row_count;
  delete from public.booking_idempotency where created_at < p_now - interval '30 days';                    -- a retry after 30 days is a new booking, not a replay
  get diagnostics v_idem = row_count;
  delete from public.token_uses where expires_at < p_now - interval '1 day';                               -- an expired token is refused by its signature anyway
  get diagnostics v_tokens = row_count;
  delete from public.job_runs where status <> 'running' and started_at < p_now - interval '30 days';       -- heartbeat history; a stuck 'running' row is kept for the lease logic
  get diagnostics v_jobs = row_count;
  delete from public.domain_events where processed_at is not null and processed_at < p_now - interval '90 days';
  get diagnostics v_events = row_count;
  return jsonb_build_object('rateCounters', v_rate, 'idempotency', v_idem, 'tokenUses', v_tokens, 'jobRuns', v_jobs, 'domainEvents', v_events);
end $$;

-- One row per job: when it last started, when it last succeeded, and how many runs failed in the last day. Monitoring compares these with the expected interval.
create function private.job_status_impl() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('job', job_name, 'lastStart', last_start, 'lastOk', last_ok, 'failed24h', failed_24h) order by job_name), '[]'::jsonb)
  from (
    select job_name, max(started_at) as last_start, max(finished_at) filter (where status = 'succeeded') as last_ok,
           count(*) filter (where status = 'failed' and started_at > now() - interval '1 day') as failed_24h
    from public.job_runs group by job_name
  ) j
$$;

create function public.maintenance_run(p_now timestamptz default now()) returns jsonb language sql security invoker set search_path = '' as $$ select private.maintenance_impl(p_now) $$;
create function public.job_status() returns jsonb language sql stable security invoker set search_path = '' as $$ select private.job_status_impl() $$;
revoke all on function private.maintenance_impl(timestamptz), private.job_status_impl(), public.maintenance_run(timestamptz), public.job_status() from public, anon, authenticated;
grant execute on function private.maintenance_impl(timestamptz), private.job_status_impl(), public.maintenance_run(timestamptz), public.job_status() to service_role;
