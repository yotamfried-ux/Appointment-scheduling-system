-- pgTAP: housekeeping deletes only what it should (and nothing else), and the job heartbeat summary.
begin;
select * from no_plan();

delete from public.rate_counters; delete from public.booking_idempotency; delete from public.token_uses; delete from public.job_runs;

insert into public.rate_counters (key, window_start, hits) values ('old', now() - interval '3 days', 5), ('new', now(), 1);
insert into public.token_uses (jti, expires_at) values ('expired-token-1', now() - interval '3 days'), ('live-token-0001', now() + interval '1 hour');
insert into public.job_runs (job_name, run_key, status, started_at, finished_at) values
  ('outbox', 'old-ok', 'succeeded', now() - interval '40 days', now() - interval '40 days'),
  ('outbox', 'old-stuck', 'running', now() - interval '40 days', null),
  ('outbox', 'recent-ok', 'succeeded', now() - interval '5 minutes', now() - interval '5 minutes'),
  ('outbox', 'recent-failed', 'failed', now() - interval '2 hours', now() - interval '2 hours'),
  ('waitlist', 'w1', 'succeeded', now() - interval '3 minutes', now() - interval '3 minutes');

select throws_ok($$ set local role authenticated; select public.maintenance_run() $$, '42501', null, 'signed-in users cannot run maintenance');
reset role;
select throws_ok($$ set local role anon; select public.job_status() $$, '42501', null, 'anonymous callers cannot read job status');
reset role;

set local role service_role;
select is(public.maintenance_run() ->> 'rateCounters', '1', 'one stale rate counter removed');
select is((select count(*)::int from public.rate_counters), 1, '...and the current one stays');
select is((select count(*)::int from public.token_uses where jti = 'live-token-0001'), 1, 'a live token record stays');
select is((select count(*)::int from public.token_uses where jti = 'expired-token-1'), 0, '...an expired one goes');
select is((select count(*)::int from public.job_runs where run_key = 'old-ok'), 0, 'old finished heartbeat rows go');
select is((select count(*)::int from public.job_runs where run_key = 'old-stuck'), 1, 'a stuck running row is never silently dropped');
select is((select count(*)::int from public.job_runs where run_key in ('recent-ok', 'recent-failed', 'w1')), 3, 'recent history stays');
select is(public.maintenance_run() ->> 'rateCounters', '0', 'running it again removes nothing more (idempotent)');

select is((select (j ->> 'failed24h')::int from jsonb_array_elements(public.job_status()) j where j ->> 'job' = 'outbox'), 1, 'job status counts failures of the last day');
select ok((select (j ->> 'lastOk')::timestamptz > now() - interval '10 minutes' from jsonb_array_elements(public.job_status()) j where j ->> 'job' = 'outbox'), 'job status reports the last success');
select is((select count(*)::int from jsonb_array_elements(public.job_status()) j), 2, 'one row per job');
reset role;

select * from finish();
rollback;
