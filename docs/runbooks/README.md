# Runbooks

Short, concrete procedures for the things that will go wrong. Each one says how you notice, what to do, and how to know it worked. They were written against the system as built and rehearsed where marked **(drilled)**.

| Situation | Runbook |
|---|---|
| Put a test environment in the cloud, with a demo user | [deploy-test-environment.md](deploy-test-environment.md) |
| Mail is not going out, or customers say they got nothing | [mail.md](mail.md) |
| A scheduled job stopped (reminders, outbox, waitlist) | [jobs.md](jobs.md) |
| Subscriptions look wrong, a payment webhook failed | [billing.md](billing.md) |
| The database is down or slow **(drilled)** | [database.md](database.md) |
| Restore from a backup **(drilled)** | [restore.md](restore.md) |
| A secret leaked, or a routine rotation is due | [secrets.md](secrets.md) |
| Suspected breach or cross-tenant exposure | [incident.md](incident.md) (roles, first hour, decision record; draft), [docs/05 §11](../05-security-architecture.md), then [secrets.md](secrets.md) |

Monitoring hooks that already exist: `GET /api/health` (liveness), `GET /api/ready` (database reachable, 503 otherwise), `GET /api/jobs/health` with `Authorization: Bearer $CRON_SECRET` (200 when every job succeeded recently, 503 and the list of stale jobs otherwise). Point an external uptime monitor at the last two.
