# Database growth and cost (updated 2026-10-21)

Goal: as data accumulates, the database must not quietly become expensive. What costs money is mostly **compute** (CPU, so the per-request work), **number of projects**, and later **disk**. Everything below was measured, not assumed.

## 1. What was measured (local database, 800k appointments)
Drill: `scripts/drills/scale.sh` (200 businesses x ~4,000 appointments, 80k customers, 800k messages; about 1 GB).

| | |
|---|---|
| Size | ~1.25 KB per appointment all-in (row, indexes, its message, the customer share). Supabase Pro includes ~8 GB, i.e. roughly **6 million appointments** before disk is billed |
| Before the 2026-10-21 fix, as the signed-in owner | customers list **324 ms**, report **~800 ms** (30 days as much as 140 days), growing with every appointment |
| Cause | every read policy called `private.is_member(...)` **once per row** (17 ms and 14 ms without row level security) |
| After (migration `20261039`) | customers list **17 ms**, search **4 ms**, report **8-14 ms**, one day's agenda 2 ms, a customer's appointments 0.4 ms |

Run the drill before a release that touches a policy, an index or a hot query: `npm run db:start && scripts/drills/scale.sh` (budget 100 ms per query; normal 2-20 ms). `npx supabase db reset` removes the seeded data. It must never be pointed at a cloud project.

## 2. Rules that keep it cheap
1. **Read policies:** a new table's SELECT policy is `business_id in (select private.my_business_ids('staff'))` (or `'admin'`), never `private.is_member(business_id, ...)` per row. A pgTAP test (`210_rls_once_per_query`) fails if one comes back. Write policies may use `is_member` (they touch single rows).
2. **Filter on the stored value, not on a function of it:** `starts_at >= x and starts_at < y` uses the index; `(starts_at at time zone tz)::date between a and b` does not.
3. **Every list is paged and limited** (agenda 300, customers 25, exports stream in pages of 1,000). New lists follow the same.
4. **Fewer round trips:** each call to the database API costs ~60 ms in the same region. The public availability call is one call (`public_range`), the owner context is one read. The API reports calls per request in `Server-Timing` outside production; `tests/e2e/owner-speed.spec.ts` pins the count.
5. **Indexes only for a measured need.** Each index costs disk and slows every write. Add one when `explain analyze` shows a scan on a hot query, not "just in case". The Supabase advisor lists unused indexes and foreign keys without one; with test data both lists mean nothing, so review them after 2-3 months of real traffic and drop only indexes that back no constraint.

## 3. What grows, and what removes it
| Table | Growth | Removed by |
|---|---|---|
| `appointments`, `customers`, `waitlist_*` | with business activity | customer details: 3 years after last activity (migration `20261037`), whole business: 14-day grace deletion; appointment facts stay without identity |
| `notification_log` | ~1 row per message | finished rows older than 90 days (migration `20261040`); queued/failed rows are never removed |
| `rate_counters` 1 d, `token_uses` 1 d, `booking_idempotency` 30 d, `job_runs` 30 d, `domain_events` (processed) 90 d | technical | `maintenance_run`, daily |
| `audit_log` | append-only, small (no personal data) | never; revisit the period with counsel (see `docs/legal/open-decisions.md`) |
| `email_suppressions` | one hash per bounced address | never (intended) |
| Supabase backups, logs | provider | provider plan |

## 4. Thresholds and what to do
| Signal | Where to look | Action |
|---|---|---|
| Database size above ~4 GB (half of what is included) | Supabase Dashboard, Database, Usage; or `select pg_size_pretty(pg_database_size(current_database()))` | find the largest tables (query below); confirm the purges ran (`job_status` shows the maintenance job); check for a business with unusual volume |
| Any hot query over ~100 ms in the drill | `scripts/drills/scale.sh` | read the plan; usually a per-row function in a policy, a missing index, or a filter on a computed value |
| CPU of the database above ~60% for hours | Supabase Dashboard, Reports | look at slow queries first (Logs, Query performance), upgrade compute last |
| Number of projects | Supabase billing | a test project and a production project are the intent; delete experiments |

Largest tables:
```sql
select relname, pg_size_pretty(pg_total_relation_size(oid)) from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r' order by pg_total_relation_size(oid) desc limit 10;
```

## 5. Storage audit (2026-10-21, measured on the 800k-appointment drill)
How the bytes are spent, per appointment (table + indexes):
| Table | Per row | Of which indexes | Note |
|---|---|---|---|
| `appointments` | ~530 B | ~205 B (5 indexes) | the largest index is `(business_id, customer_id, starts_at)` at 62 MB / 800k rows; both it and `(business_id, starts_at)` serve real queries (customer detail, report, agenda) |
| `notification_log` | ~390 B | ~120 B | one row per message; now capped at 90 days (migration `20261040`), so its steady state is the last 90 days only, not the whole history |
| `customers` | ~210 B | ~80 B | |

What the audit found, and what was deliberately left alone:
- **No over-fetching:** no `select *` anywhere in the application; every list is paged or limited; counts use `head: true`. Nothing to change.
- **The one growth that was unbounded** was `notification_log` (about 37% of all bytes) and it is bounded now.
- **Repeated short text** (`status`, `location`, `source`, `currency` stored as text, `service_snapshot` as JSON): about 80-100 B per appointment, roughly 15%. Converting them to enums or small integers would save that, but it is a rewrite of a live schema and every function that reads them, for a gain that only matters in the millions of appointments. Not done; revisit if the database ever approaches the included disk.
- **`appointments_reference_key`** (unique index on the confirmation number, 41 MB per 800k rows, ~8% of the table's bytes) guarantees no two appointments share a number. The application never looks an appointment up by that number, so the index only protects uniqueness for support and customers who quote it. Kept; if support never looks appointments up by number, a shorter or non-unique reference would save it.
- **Indexes that back a constraint or the booking guarantee** (the no-double-booking exclusion index, `(appointment_id, type)` message idempotency, the `(business_id, phone)` customer key) are not candidates for removal.

## 6. Costs that are not the database
- **Add-ons:** point-in-time recovery is a separate monthly charge of a different order than the base plan; daily backups are included. Decide on PITR when there are paying customers (see gap G-06 in `docs/legal/open-decisions.md`).
- **Projects:** each additional project is billed (the dashboard quoted $10 a month for a micro compute). The Singapore test project was deleted for that reason.
- **Vercel** bills function time, so fewer database calls per request lower that bill as well.
