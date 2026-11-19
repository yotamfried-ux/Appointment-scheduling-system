#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

if [[ $# != 1 ]]; then
  echo 'Usage: bash scripts/recording/capture.sh /absolute/new-output-directory' >&2
  exit 2
fi

out="$1"
if [[ "$out" != /* || -e "$out" ]]; then
  echo 'Use an absolute output directory that does not already exist.' >&2
  exit 2
fi
for envfile in .env .env.local .env.production .env.production.local .env.test .env.test.local; do
  if [[ -e "$envfile" ]]; then
    echo 'Use a clean Tori checkout without Next.js environment files.' >&2
    exit 2
  fi
done

# The disposable Supabase stack must already be running. Only import its local keys.
env -i PATH="$PATH" HOME="$HOME" TORI_CAPTURE_DIR="$out"   TORI_CHROMIUM_PATH="${TORI_CHROMIUM_PATH:-}" TORI_RECORDING_KEYS="${TORI_RECORDING_KEYS:-}" NEXT_TELEMETRY_DISABLED=1   bash -euo pipefail <<'RUN'
if [[ -n "$TORI_RECORDING_KEYS" ]]; then
  export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1])).anon' "$TORI_RECORDING_KEYS")
  SUPABASE_SECRET_KEY=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1])).service' "$TORI_RECORDING_KEYS")
  export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY E2E_REAL_SUPABASE=1
else
  source scripts/local-env.sh
fi
if [[ "$NEXT_PUBLIC_SUPABASE_URL" != 'http://127.0.0.1:54321' && "$NEXT_PUBLIC_SUPABASE_URL" != 'http://localhost:54321' ]]; then
  echo 'Capture requires the default loopback Supabase API.' >&2
  exit 2
fi
export NODE_OPTIONS="--require=$PWD/scripts/recording/local-only.cjs"
export BILLING_PROVIDER=fake EMAIL_PROVIDER=fake OUTBOX_KICK=0 ALLOW_NON_PRODUCTION_DEFAULTS=1
BOOKING_TOKEN_SECRET=$(node -p 'require("node:crypto").randomBytes(32).toString("hex")')
export BOOKING_TOKEN_SECRET
export APP_URL=http://127.0.0.1:3175
export NEXT_PUBLIC_APP_URL="$APP_URL"
mkdir -p "$TORI_CAPTURE_DIR/webm" "$TORI_CAPTURE_DIR/mp4"

npm run build
npx --no-install playwright test --config playwright.recording.config.ts

for name in booking-desktop calendar-owner availability-settings confirmation-preview booking-mobile; do
  file="$TORI_CAPTURE_DIR/mp4/$name.mp4"
  ffmpeg -nostdin -hide_banner -loglevel error -i "$TORI_CAPTURE_DIR/webm/$name.webm" \
    -map 0:v:0 -an -c:v libx264 -threads 2 -preset medium -crf 17 -pix_fmt yuv420p \
    -movflags +faststart "$file"
  ffmpeg -nostdin -hide_banner -loglevel error -xerror -i "$file" -f null -
done
RUN
