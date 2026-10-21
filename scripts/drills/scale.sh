#!/usr/bin/env bash
# Growth drill: seed ~800k appointments into the LOCAL database and check that the hot owner/customer queries stay fast, as the signed-in owner (row level security on).
# Usage: scripts/drills/scale.sh [budget_ms]   (default budget 100 ms per query; a normal run is 2-20 ms)
# Needs `npm run db:start`. Afterwards `npx supabase db reset` removes the data. Exit 1 when a query is over budget (usually a missing index or a per-row policy).
set -euo pipefail
BUDGET="${1:-100}"
DB="supabase_db_appointment-scheduling-system"
HERE="$(cd "$(dirname "$0")" && pwd)"
docker exec "$DB" psql -U postgres -Atc "select 1" >/dev/null || { echo "local database is not running (npm run db:start)"; exit 2; }
if [ "$(docker exec "$DB" psql -U postgres -Atc "select count(*) from public.businesses where slug like 'scale-%'")" = "0" ]; then
  echo "seeding (about a minute)..."
  docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -q < "$HERE/scale-seed.sql" >/dev/null
fi
OWNER='{"sub":"00000000-0000-0000-5ca1-000000000007","role":"authenticated"}'
BIZ='00000000-0000-0000-b1b1-000000000007'
fail=0
run() { # name, role, sql
  local out ms
  out=$(docker exec -i "$DB" psql -U postgres -At <<SQL
select set_config('request.jwt.claims', '$OWNER', false);
set role $2;
explain (analyze, summary on) $3;
SQL
)
  ms=$(echo "$out" | grep -o "Execution Time: [0-9.]*" | grep -o "[0-9.]*$" | tail -1)
  printf "%-44s %8s ms" "$1" "$ms"
  if awk "BEGIN{exit !($ms > $BUDGET)}"; then echo "   OVER BUDGET ($BUDGET)"; fail=1; else echo; fi
}
run "agenda: one day"                         authenticated "select id, status, starts_at from public.appointments where business_id = '$BIZ' and starts_at >= date_trunc('day', now()) - interval '10 days' and starts_at < date_trunc('day', now()) - interval '9 days' order by starts_at limit 300"
run "customers list, first page"              authenticated "select * from public.owner_customers('$BIZ', null, 'last_visit', 25, 0)"
run "customers search"                        authenticated "select * from public.owner_customers('$BIZ', 'לקוח 12', 'last_visit', 25, 0)"
run "customers sorted by visits"              authenticated "select * from public.owner_customers('$BIZ', null, 'visits', 25, 0)"
run "report, 30 days"                         authenticated "select public.owner_report('$BIZ', (current_date - 30)::date, current_date::date)"
run "report, 140 days"                        authenticated "select public.owner_report('$BIZ', (current_date - 140)::date, current_date::date)"
run "one customer's appointments"             authenticated "select id, status, starts_at from public.appointments where business_id = '$BIZ' and customer_id = '00000000-0000-0000-c057-000000007010' order by starts_at desc limit 50"
run "busy times for the public page (30 d)"   service_role   "select * from public.public_busy('$BIZ', now() - interval '1 day', now() + interval '31 days')"
run "pending messages picker"                 service_role   "select id from public.notification_log where status in ('queued','failed','sending') and next_attempt_at <= now() limit 50"
[ "$fail" = 0 ] && echo "OK: every query is within ${BUDGET} ms at $(docker exec "$DB" psql -U postgres -Atc "select count(*) from public.appointments") appointments" || { echo "FAILED"; exit 1; }
