#!/usr/bin/env bash
# SEC-04: no secret key may ever reach the browser. Scans the client bundle produced by `next build`.
# Negative control: `scripts/check-bundle.sh --self-test` plants a fake key and expects a failure.
set -euo pipefail
DIR="${1:-.next/static}"
if [[ "${1:-}" == "--self-test" ]]; then
  tmp="$(mktemp -d)"; echo 'const k="sb_secret_PLANTED";' > "$tmp/x.js"
  if "$0" "$tmp" >/dev/null 2>&1; then echo "self-test FAILED: planted secret not detected"; exit 1; fi
  echo "self-test ok: planted secret detected"; exit 0
fi
if grep -rIlE 'sb_secret_|SUPABASE_SECRET|SUPABASE_SERVICE_ROLE|"role":"service_role"' "$DIR"; then
  echo "FAIL: secret material found in the client bundle"; exit 1
fi
# Canary: CI builds with SUPABASE_SECRET_KEY set to a unique value; the real value (whatever it is) must not appear in the bundle either.
if [[ -n "${SUPABASE_SECRET_KEY:-}" && ${#SUPABASE_SECRET_KEY} -ge 12 ]] && grep -rIlF -- "$SUPABASE_SECRET_KEY" "$DIR"; then
  echo "FAIL: the secret key value itself is in the client bundle"; exit 1
fi
echo "ok: no secret material in $DIR"
