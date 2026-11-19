#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ $# != 1 || "$1" != /* || -e "$1" ]]; then
  echo 'Usage: bash scripts/recording/start-compact-stack.sh /absolute/new-state-directory' >&2
  exit 2
fi
state="$1"
for executable in "${TORI_PG_BIN:?Set the PostgreSQL bin directory}/postgres" "${TORI_AUTH_BIN:?Set the GoTrue executable}" "${TORI_REST_BIN:?Set the PostgREST executable}"; do
  [[ -x "$executable" ]] || { echo "Missing local binary: $executable" >&2; exit 2; }
done
umask 077
mkdir "$state"
secret=$(node -p 'require("node:crypto").randomBytes(40).toString("hex")')
password=$(node -p 'require("node:crypto").randomBytes(20).toString("hex")')
rest_password=$(node -p 'require("node:crypto").randomBytes(20).toString("hex")')
cleanup() {
  for child in "${gateway_pid:-}" "${rest_pid:-}" "${auth_pid:-}"; do
    if [[ -n "$child" ]]; then kill "$child" 2>/dev/null || true; fi
  done
  "$TORI_PG_BIN/pg_ctl" -D "$state/db" -w stop -m fast >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf '%s\n' "$password" | "$TORI_PG_BIN/initdb" -D "$state/db" -U postgres --auth-host=scram-sha-256 --auth-local=trust --pwfile=/dev/stdin --encoding=UTF8 --no-locale > "$state/postgres-init.log"
"$TORI_PG_BIN/pg_ctl" -D "$state/db" -l "$state/postgres.log" -o "-p 55432 -h 127.0.0.1 -k $state -c jit=off" -w start >/dev/null
db() { "$TORI_PG_BIN/psql" -h "$state" -p 55432 -X -q -v ON_ERROR_STOP=1 -U postgres "$@"; }

db -v rest_password="$rest_password" <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit password :'rest_password';
grant anon, authenticated, service_role to authenticator;
create schema auth;
create schema extensions;
grant usage on schema auth, extensions to anon, authenticated, service_role;
create function auth.jwt() returns jsonb language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
create function auth.uid() returns uuid language sql stable set search_path = '' as $$
  select nullif(auth.jwt()->>'sub', '')::uuid
$$;
SQL

env -i PATH="$PATH" GOTRUE_API_HOST=127.0.0.1 PORT=55433 \
  API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1 GOTRUE_SITE_URL=http://127.0.0.1:3175 \
  GOTRUE_DB_DRIVER=postgres GOTRUE_DB_DATABASE_URL="postgres://postgres:$password@127.0.0.1:55432/postgres?search_path=auth" \
  GOTRUE_DB_NAMESPACE=auth GOTRUE_JWT_SECRET="$secret" GOTRUE_JWT_AUD=authenticated \
  GOTRUE_JWT_ADMIN_ROLES=service_role GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
  GOTRUE_DISABLE_SIGNUP=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
  "$TORI_AUTH_BIN" > "$state/auth.log" 2>&1 &
auth_pid=$!

for _ in {1..60}; do
  if [[ "$(db -Atc "select to_regclass('auth.mfa_factors') is not null")" == t ]]; then break; fi
  sleep 1
done
for migration in supabase/migrations/*.sql; do
  if ! db < "$migration" >> "$state/migrations.log" 2>&1; then
    echo "Local migration failed: $(basename "$migration"). See the private state directory log." >&2
    exit 1
  fi
done
db <<'SQL'
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
SQL

env -i PATH="$PATH" PGRST_DB_URI="postgres://authenticator:$rest_password@127.0.0.1:55432/postgres" \
  PGRST_DB_SCHEMAS=public PGRST_DB_EXTRA_SEARCH_PATH=public,extensions PGRST_DB_ANON_ROLE=anon \
  PGRST_JWT_SECRET="$secret" PGRST_SERVER_HOST=127.0.0.1 PGRST_SERVER_PORT=55434 \
  "$TORI_REST_BIN" > "$state/rest.log" 2>&1 &
rest_pid=$!
AUTH_PORT=55433 REST_PORT=55434 node scripts/recording/gateway.cjs &
gateway_pid=$!

JWT_SECRET="$secret" STATE_DIR="$state" node <<'JS'
const { createHmac } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const token = (role) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const claims = encode({ alg: "HS256", typ: "JWT" }) + "." + encode({
    iss: "tori-capture", role, exp: Math.floor(Date.now() / 1000) + 86400,
  });
  return claims + "." + createHmac("sha256", process.env.JWT_SECRET).update(claims).digest("base64url");
};
writeFileSync(process.env.STATE_DIR + "/keys.json", JSON.stringify({ anon: token("anon"), service: token("service_role") }), { mode: 0o600 });
JS

printf 'Isolated stack running. Use TORI_RECORDING_KEYS=%s/keys.json with capture.sh.\n' "$state"
wait "$gateway_pid"
