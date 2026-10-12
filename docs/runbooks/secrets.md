# Secrets: rotation and leaks

Rule: a secret lives in the hosting environment, one set per environment (Preview never shares Production's). `npm run check:env` (with the production values) refuses placeholders, test switches and missing secrets before a deploy. **Order matters: add the new, deploy, switch the provider, remove the old.**

| Secret | How to rotate | Side effects |
|---|---|---|
| `SUPABASE_SECRET_KEY` | create a new secret key in Supabase, set it, redeploy, delete the old one | none; the browser never holds it (a bundle scan runs in CI) |
| `BOOKING_TOKEN_SECRET` | set the new value, move the old one to `BOOKING_TOKEN_SECRET_PREVIOUS`, redeploy; remove `_PREVIOUS` after the longest token lifetime (a customer's manage link lives until the appointment plus 7 days; code: `modules/booking/token.ts`) | links already e-mailed keep working until `_PREVIOUS` is removed |
| `CRON_SECRET` | change in the host **and** in any external scheduler, redeploy | jobs return 401 until both match |
| `RESEND_API_KEY` | new sending-only key in Resend, set, redeploy, revoke the old | mail retries cover the gap (outbox) |
| `RESEND_WEBHOOK_SECRET` | rotate in Resend, set the new `whsec_…`, redeploy | bounces during the gap are lost, check Resend's log |
| `NOTIFICATIONS_PEPPER` | **avoid**: it keys the hash of every address in the suppression list; changing it forgets all suppressions | only rotate after a confirmed leak, and expect some bounced addresses to be mailed again |
| billing provider keys / `BILLING_WEBHOOK_SECRET` | per the provider; the fake provider is never in production | |

**If a secret leaked:** rotate it first (above), then look for use: `audit_log`, Supabase and Vercel logs for the window. A leaked `SUPABASE_SECRET_KEY` means assume the whole database was readable: follow docs/05 §11 (incident response, notification duty, legal advice).
