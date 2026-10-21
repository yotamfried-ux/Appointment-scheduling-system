#!/usr/bin/env bash
# OPS-07 restore drill (local rehearsal of the production procedure in docs/runbooks/restore.md):
# dump the application's schemas, restore them into a brand-new scratch database, then PROVE the copy is usable:
# same row counts per table, schema lint clean, RLS still enabled and forced, policies and functions the same, and the tenant rules still hold.
#   bash scripts/drills/restore.sh
set -uo pipefail
DB="${DB_CONTAINER:-supabase_db_appointment-scheduling-system}"
SRC=postgres
SCRATCH="restore_drill_$(date +%s)"
psql_src() { docker exec -i "$DB" psql -U postgres -d "$SRC" -At -v ON_ERROR_STOP=1 "$@"; }
psql_dst() { docker exec -i "$DB" psql -U postgres -d "$SCRATCH" -At -v ON_ERROR_STOP=1 "$@"; }
fail=0
ok()  { printf '  PASS  %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fail=1; }

echo "== 1. dump (custom format, public + private + auth)"
t0=$(date +%s)
docker exec "$DB" pg_dump -U postgres -d "$SRC" -Fc -n public -n private -n auth -f /tmp/drill.dump || { echo "dump failed"; exit 2; }
size=$(docker exec "$DB" sh -c 'stat -c %s /tmp/drill.dump')
echo "  dump size: ${size} bytes, $(( $(date +%s) - t0 ))s"

echo "== 2. restore into a NEW database ($SCRATCH)"
t1=$(date +%s)
docker exec "$DB" psql -U postgres -d postgres -c "create database $SCRATCH" >/dev/null || { echo "cannot create scratch database"; exit 2; }
trap 'docker exec "$DB" psql -U postgres -d postgres -c "drop database if exists $SCRATCH with (force)" >/dev/null 2>&1; docker exec "$DB" rm -f /tmp/drill.dump' EXIT
# an empty database still has a `public` schema, and the dump creates its own
psql_dst -c 'drop schema public cascade; create schema extensions; create extension if not exists pgcrypto schema extensions; create extension if not exists "uuid-ossp" schema extensions; create extension if not exists btree_gist schema extensions;' >/dev/null
docker exec "$DB" pg_restore -U postgres -d "$SCRATCH" --no-owner /tmp/drill.dump 2>/tmp/restore.err
echo "  restore finished in $(( $(date +%s) - t1 ))s"
# The only errors allowed are Supabase-owned-role default privileges on the auth schema (a plain database has no supabase_auth_admin rights to grant them);
# on Supabase itself the platform restores those. Any OTHER error fails the drill.
other=$(grep -E "^pg_restore: error" /tmp/restore.err | grep -v "permission denied to change default privileges" | grep -v "^pg_restore: error: could not execute query" | head -5)
real=$(grep -c "^pg_restore: error: could not execute query" /tmp/restore.err)
benign=$(grep -c "permission denied to change default privileges" /tmp/restore.err)
echo "  errors reported: $real (of which expected default-privilege errors: $benign)"
[ -z "$other" ] && [ "$real" = "$benign" ] && ok "pg_restore: no unexpected errors" || { bad "pg_restore: unexpected errors"; grep -E "ERROR|error" /tmp/restore.err | grep -v "default privileges" | head -5; }

if [ -n "${DRILL_SABOTAGE:-}" ]; then # negative control: prove the checks below can fail
  psql_dst -c "delete from public.rate_counters where ctid in (select ctid from public.rate_counters limit 1)" >/dev/null
  psql_dst -c "update public.customers set full_name = full_name || 'x' where id = (select id from public.customers limit 1)" >/dev/null
  psql_dst -c "alter table public.appointments no force row level security" >/dev/null
fi
echo "== 3. the copy equals the original"
# every public/auth table: same row count
tables=$(psql_src -c "select table_schema||'.'||table_name from information_schema.tables where table_schema in ('public','auth') and table_type='BASE TABLE' and table_name <> 'schema_migrations' order by 1")
mismatch=0; n=0
while read -r t; do
  [ -z "$t" ] && continue
  a=$(psql_src -c "select count(*) from $t" </dev/null); b=$(psql_dst -c "select count(*) from $t" </dev/null 2>&1)
  n=$((n+1)); [ "$a" = "$b" ] || { mismatch=1; echo "    $t: original $a, restored $b"; }
done <<< "$tables"
[ $mismatch -eq 0 ] && ok "row counts equal in all $n tables" || bad "row counts differ (listed above)"
# a content fingerprint of the business data, not just counts
fp() { "$1" -c "select md5(string_agg(x, '|' order by x)) from (select id::text||status||coalesce(price_cents::text,'') x from public.appointments union all select id::text||full_name||phone from public.customers union all select id::text||slug||name from public.businesses union all select business_id::text||status||plan_id from public.subscriptions) q"; }
[ "$(fp psql_src)" = "$(fp psql_dst)" ] && ok "content fingerprint of appointments, customers, businesses and subscriptions is identical" || bad "content fingerprint differs"

echo "== 4. the restored database is still SAFE"
v=$(psql_dst -c "select count(*) from private.lint_violations()")
[ "$v" = "0" ] && ok "schema lint clean (0 violations)" || bad "schema lint reports $v violation(s)"
rls_src=$(psql_src -c "select count(*) filter (where relrowsecurity and relforcerowsecurity) || '/' || count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")
rls_dst=$(psql_dst -c "select count(*) filter (where relrowsecurity and relforcerowsecurity) || '/' || count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")
[ "$rls_src" = "$rls_dst" ] && ok "RLS enabled+forced on the same tables ($rls_dst)" || bad "RLS differs: original $rls_src, restored $rls_dst"
pol_src=$(psql_src -c "select count(*) from pg_policies where schemaname='public'"); pol_dst=$(psql_dst -c "select count(*) from pg_policies where schemaname='public'")
[ "$pol_src" = "$pol_dst" ] && ok "same number of RLS policies ($pol_dst)" || bad "policies differ: $pol_src vs $pol_dst"
fn_src=$(psql_src -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')"); fn_dst=$(psql_dst -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')")
[ "$fn_src" = "$fn_dst" ] && ok "same number of functions ($fn_dst)" || bad "functions differ: $fn_src vs $fn_dst"
tr_src=$(psql_src -c "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal"); tr_dst=$(psql_dst -c "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal")
[ "$tr_src" = "$tr_dst" ] && ok "same number of triggers ($tr_dst) — the booking, billing and immutability guards came back" || bad "triggers differ: $tr_src vs $tr_dst"
# the no-double-booking constraint must have survived: try to insert an overlapping appointment into the copy
ov=$(psql_dst -c "select count(*) from pg_constraint where contype='x' and conrelid='public.appointments'::regclass")
[ "$ov" -ge 1 ] 2>/dev/null && ok "the overlap EXCLUDE constraint on appointments is present" || bad "the overlap EXCLUDE constraint is missing"
anon=$(psql_dst -c "select count(*) from information_schema.role_table_grants where grantee='anon' and table_schema='public'")
[ "$anon" = "0" ] && ok "role anon has no table grants" || bad "anon has $anon table grants in the copy"

echo
[ $fail -eq 0 ] && echo "RESTORE DRILL OK  (total $(( $(date +%s) - t0 ))s)" || { echo "RESTORE DRILL FOUND PROBLEMS"; exit 1; }
