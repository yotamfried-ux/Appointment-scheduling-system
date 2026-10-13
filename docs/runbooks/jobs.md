# A scheduled job stopped

Jobs: `outbox` (every 5 min), `reminders` (15), `waitlist` (5), `maintenance` (daily 03:20). All are idempotent and safe to run twice or in parallel (rows are claimed with `SKIP LOCKED`; `job_runs` records each run).

**How you notice:** `GET /api/jobs/health` returns 503 and names the stale job; or a user reports missing reminders / waitlist offers that never expire.

1. **See what the database says:**
   ```sql
   select job_name, max(started_at) last_start, max(finished_at) filter (where status='succeeded') last_ok,
          count(*) filter (where status='failed' and started_at > now()-interval '1 day') failed_24h
   from job_runs group by 1;
   select job_name, started_at, error from job_runs where status='failed' order by started_at desc limit 10;
   ```
2. **Never ran at all** → the cron is not enabled. In Vercel: Project → Settings → Cron Jobs must list the four paths from `vercel.json`, `CRON_SECRET` must be set, and **the plan must allow the frequency** (the free tier allows daily crons only; every-5-minutes needs a paid plan). If the plan cannot be changed, schedule the same four URLs from another scheduler (a GitHub Actions `schedule`, an external cron service) sending the same `Authorization` header.
3. **Runs but fails** → read `error` above. A 401 means the secret differs between the scheduler and the app. A timeout means the batch is too big; the next run continues where it left off.
4. **Trigger by hand:** `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/jobs/<name>`.
5. A row stuck in `running` for hours is a crashed run; it is ignored by the next one (the lease expires) and is never deleted by maintenance.

**Done when:** `/api/jobs/health` is 200. Reminders missed during an outage are **not** re-sent for appointments that already started (that is deliberate: a reminder after the fact is noise).


## Cron schedules: test (Hobby) vs production
`vercel.json` currently holds **daily** schedules, because the free Hobby plan refuses anything more frequent and the project cannot even be created with `*/5`. With daily runs the system works but mail, reminders and waitlist offers go out once a day, which is **not acceptable for production**.
Before launch (checklist A3) either use a Pro plan and restore these values in `vercel.json`, or call the four URLs from another scheduler with `Authorization: Bearer $CRON_SECRET`:

```json
{ "path": "/api/jobs/outbox",      "schedule": "*/5 * * * *" },
{ "path": "/api/jobs/reminders",   "schedule": "*/15 * * * *" },
{ "path": "/api/jobs/waitlist",    "schedule": "*/5 * * * *" },
{ "path": "/api/jobs/maintenance", "schedule": "20 3 * * *" }
```
