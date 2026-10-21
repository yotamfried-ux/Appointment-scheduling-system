-- Growth: notification_log gets a row for every message and had no age limit while a business was active (about one row per appointment, forever).
-- Finished rows (sent / skipped / dead) older than 90 days are removed by the daily maintenance job; rows still waiting or being retried are never touched.
-- Nothing depends on an old finished row: reminders and offers are never created for past events, and the daily-digest key only has to be unique within its own day.

create or replace function private.maintenance_impl(p_now timestamptz default now()) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rate int; v_idem int; v_tokens int; v_jobs int; v_events int; v_notif int;
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
  delete from public.notification_log where status in ('sent', 'skipped', 'dead') and created_at < p_now - interval '90 days';
  get diagnostics v_notif = row_count;
  return jsonb_build_object('rateCounters', v_rate, 'idempotency', v_idem, 'tokenUses', v_tokens, 'jobRuns', v_jobs, 'domainEvents', v_events, 'notificationLog', v_notif);
end $$;
