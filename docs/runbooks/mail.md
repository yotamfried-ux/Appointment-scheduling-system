# Mail is not going out

**How you notice:** owners see the "messages that could not be delivered" banner on the dashboard; a customer says there was no confirmation; `/api/jobs/health` reports `outbox` stale.

1. **Is the job running?** `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/jobs/health`. If `outbox` is stale go to [jobs.md](jobs.md).
2. **Look at the log (no addresses are stored, only status):**
   ```sql
   select status, count(*), min(created_at) from notification_log where created_at > now() - interval '1 day' group by status;
   select id, type, attempts, error from notification_log where status in ('failed','dead') order by created_at desc limit 20;
   ```
   `queued/sending` for long = the runner is not claiming (lease is 5 minutes); `failed` = retrying with backoff (7 attempts); `dead` = gave up.
3. **Provider problem** (Resend outage, key revoked, domain unverified): errors mention the provider status. Fix the cause (new key → [secrets.md](secrets.md); verify SPF/DKIM/DMARC in Resend), then re-queue:
   ```sql
   update notification_log set status = 'queued', attempts = 0, next_attempt_at = now() where status = 'dead' and created_at > now() - interval '3 days';
   ```
   then `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/jobs/outbox`. The unique key per appointment and message type guarantees nobody gets the same mail twice; Resend also de-duplicates on the idempotency key for 24 hours.
4. **One customer never gets mail:** their address may be suppressed after a bounce/complaint. `notification_log.skip_reason = 'suppressed'`. Removal is a deliberate act (the address hash is in `email_suppressions`); do it only when the customer confirms the address is valid.
5. **Do not** resend by hand outside the outbox: the guarantees above are what keep reminders from doubling.

**Done when:** `status='dead'` is empty for the window, the banner is gone, `/api/jobs/health` is 200.
