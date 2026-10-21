#!/usr/bin/env bash
# OPS-03 drill (local): what do visitors and monitors see while the database is unreachable, and does everything recover by itself?
# Needs: the local Supabase stack (npm run db:start), a running app (npm run build && npm run start, env from scripts/local-env.sh), a published business.
#   BASE=http://127.0.0.1:3100 bash scripts/drills/db-down.sh
set -uo pipefail
BASE="${BASE:-http://127.0.0.1:3100}"
DB="${DB_CONTAINER:-supabase_db_appointment-scheduling-system}"
SLUG="$(docker exec "$DB" psql -U postgres -At -c "select slug from public.businesses where published_at is not null order by created_at desc limit 1")"
[ -n "$SLUG" ] || { echo "no published business to probe"; exit 2; }
LEAK='postgres|supabase|ECONN|ETIMEDOUT|stack|at \/|node_modules|SUPABASE|secret|jwt'
fail=0

probe() { # name path expect-regex
  local out code time body
  out="$(curl -s -o /tmp/drill.body -w '%{http_code} %{time_total}' --max-time 20 "$BASE$2")"
  code="${out% *}"; time="${out#* }"; body="$(head -c 400 /tmp/drill.body | tr '\n' ' ')"
  printf '%-34s %s  %ss\n' "$1" "$code" "$time"
  if ! [[ "$code" =~ $3 ]]; then echo "   UNEXPECTED status (wanted $3)"; fail=1; fi
  if echo "$body" | grep -qiE "$LEAK"; then echo "   LEAK in body: $(echo "$body" | grep -oiE "$LEAK" | head -1)"; fail=1; fi
}

echo "== before (database up)"
probe "liveness /api/health"          /api/health                       '^200$'
probe "readiness /api/ready"          /api/ready                        '^200$'
probe "public services"               "/api/public/$SLUG/services"      '^200$'
probe "booking page"                  "/book/$SLUG"                     '^200$'
probe "login page"                    /auth/login                       '^200$'

echo "== database paused"
docker pause "$DB" >/dev/null
trap 'docker unpause "$DB" >/dev/null 2>&1' EXIT
sleep 1
probe "liveness /api/health"          /api/health                       '^200$'      # must not depend on the database
probe "readiness /api/ready"          /api/ready                        '^503$'      # must say so, quickly
probe "public services"               "/api/public/$SLUG/services"      '^(500|503)$'
probe "public slots"                  "/api/public/$SLUG/slots?service=x&date=2026-01-01" '^(400|422|500|503)$'
probe "booking page"                  "/book/$SLUG"                     '^(200|500|503)$'
probe "login page"                    /auth/login                       '^200$'      # static shell, no DB needed

echo "== database back"
docker unpause "$DB" >/dev/null; trap - EXIT
for i in $(seq 1 30); do [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/api/ready")" = "200" ] && break; sleep 1; done
probe "readiness /api/ready"          /api/ready                        '^200$'
probe "public services"               "/api/public/$SLUG/services"      '^200$'
probe "booking page"                  "/book/$SLUG"                     '^200$'
echo "recovered after ~${i}s"
[ "$fail" = 0 ] && echo "DRILL OK" || { echo "DRILL FOUND PROBLEMS"; exit 1; }
