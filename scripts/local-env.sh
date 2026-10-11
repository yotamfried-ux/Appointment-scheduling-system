#!/usr/bin/env bash
# Usage: source scripts/local-env.sh   (exports NEXT_PUBLIC_SUPABASE_* from the running local stack)
set -euo pipefail
eval "$(npx supabase status -o env 2>/dev/null | grep -E '^(API_URL|PUBLISHABLE_KEY)=')"
export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY"
export E2E_REAL_SUPABASE=1
export MAIL_API_URL="${MAIL_API_URL:-http://127.0.0.1:54324}"
