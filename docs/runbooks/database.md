# The database is down or slow (drilled)

**What visitors see, by design** (measured with `scripts/drills/db-down.sh` while the database was frozen):

| Endpoint | During the outage | After it returns |
|---|---|---|
| `/api/health` | 200, instantly (does not use the database) | same |
| `/api/ready` | **503** within ~2 s | 200 within ~1 s |
| public API (services, slots, bookings) | **503** after the 8 s deadline, with `Retry-After: 5` and no internals | normal |
| a booking page | a friendly "something went wrong, try again" page with a reference code | normal |
| login page | works (static shell) | normal |

Nothing is lost silently: a booking either commits or the customer is told it did not. No request hangs longer than the deadline (`DB_TIMEOUT_MS`, default 8000).

1. **Confirm:** `curl https://<host>/api/ready` → 503. Check the Supabase dashboard (project status, paused projects on free plans, connection limits).
2. **If the project is paused or out of connections:** resume / restart it. The app needs no restart: it recovers by itself.
3. **If it is slow, not down:** Supabase → Reports → slowest queries; `select * from pg_stat_activity where state <> 'idle'`. The public availability endpoint is the heaviest read (~150 ms of server time per 30-day request); a burst of those is the usual cause.
4. **Data loss suspected** → [restore.md](restore.md).

Rehearse any time: `npm run db:start`, run the app, `bash scripts/drills/db-down.sh`.
