# Scheduled jobs and background workers

Jobs:
- `outbox` (every 5 min) — transactional email delivery and retry
- `reminders` (every 15 min) — customer appointment reminders
- `waitlist` (every 5 min) — waitlist slot matching and automatic offer dispatch
- `maintenance` (daily 03:20 UTC) — data retention cleanup, stale hold release, daily rollups
- `monitor` (every 15 min) — end-to-end production liveness, DB readiness, cron SLA, and alerting

All jobs are idempotent and safe to run twice or in parallel (rows are claimed with `SKIP LOCKED`; `job_runs` records each run with atomic CAS).

**How you notice an issue:**
- The automated monitor detects an incident and delivers a critical alert email to the platform operator via Resend.
- `/api/jobs/monitor` returns 503 and specifies failing components (`database`, `cron`, `app:memory`).
- `/api/jobs/health` returns 503 and names the stale job.

## 1. Inspecting job status in PostgreSQL
```sql
select job_name, max(started_at) last_start, max(finished_at) filter (where status='succeeded') last_ok,
       count(*) filter (where status='failed' and started_at > now()-interval '1 day') failed_24h
from job_runs group by 1;

select job_name, started_at, error from job_runs where status='failed' order by started_at desc limit 10;
```

## 2. Vercel Cron Configuration (Production)
The system runs on **Vercel Pro**. `vercel.json` defines all five production jobs:
```json
{
  "crons": [
    { "path": "/api/jobs/outbox",      "schedule": "*/5 * * * *" },
    { "path": "/api/jobs/reminders",   "schedule": "*/15 * * * *" },
    { "path": "/api/jobs/waitlist",    "schedule": "*/5 * * * *" },
    { "path": "/api/jobs/maintenance", "schedule": "20 3 * * *" },
    { "path": "/api/jobs/monitor",     "schedule": "*/15 * * * *" }
  ]
}
```
Vercel Cron automatically sends `Authorization: Bearer $CRON_SECRET` with each invocation.

## 3. Manual Job Invocation (CLI / Ops)
To manually trigger a background job:
```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://turim.d2ryf.com/api/jobs/<job-name>
```

To query the monitoring status with least-privilege token (read-only):
```bash
curl -H "Authorization: Bearer $MONITOR_SECRET" https://turim.d2ryf.com/api/jobs/monitor
```

## 4. Troubleshooting
- **401 Unauthorized:** The bearer secret does not match `CRON_SECRET` or `MONITOR_SECRET` configured in Vercel environment variables.
- **403 Forbidden:** A request using `MONITOR_SECRET` attempted to run a simulation (`x-monitor-simulate`) or force retry. Simulations require `CRON_SECRET`.
- **Row stuck in running:** If a worker crashes during execution, the lease expires automatically after 60 seconds (for monitor) or 5 minutes (for outbox). The next invocation claims the work cleanly.
