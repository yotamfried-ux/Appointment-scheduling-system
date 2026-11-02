# Secrets: rotation, isolation, and leak response

Rule: a secret lives in the hosting environment, one set per environment (Preview never shares Production's). `npm run check:env` (with production values) refuses placeholders, test switches, and missing secrets before a deploy. **Order matters: add the new, deploy, switch the provider, remove the old.**

| Secret | Role & Scope | How to rotate | Side effects |
|---|---|---|---|
| `SUPABASE_SECRET_KEY` | Supabase Service Role (backend operations only; never exposed to browser) | create a new secret key in Supabase Project Settings → API, set it in Vercel Production, redeploy, delete the old one | None; browser never holds it (client bundle AST scan runs in CI) |
| `CRON_SECRET` | Execution-level secret for all 5 background jobs (`/api/jobs/*`) and simulation drills | update in Vercel Environment Variables, redeploy | Vercel Cron automatically uses the updated secret; external triggers must update header |
| `MONITOR_SECRET` | Least-privilege read-only monitoring secret for `/api/jobs/monitor` and `/api/jobs/health` | update in Vercel Environment Variables, redeploy | External uptime monitors must update their Bearer token |
| `BOOKING_TOKEN_SECRET` | HMAC signature key for customer self-service links (`/booking/[token]`) | set new value, move old one to `BOOKING_TOKEN_SECRET_PREVIOUS`, redeploy; remove `_PREVIOUS` after 7 days | Links already emailed keep working until `_PREVIOUS` is removed |
| `RESEND_API_KEY` | Transactional email delivery API key | generate a new sending-only key in Resend dashboard, set in Vercel, redeploy, revoke old key in Resend | Outbox transactional queue retries cover any transient gap |
| `RESEND_WEBHOOK_SECRET` | Webhook signature verification (`whsec_...`) | rotate in Resend webhooks settings, set new value in Vercel, redeploy | Bounces during the gap can be reconciled from Resend logs |
| `NOTIFICATIONS_PEPPER` | HMAC pepper for anonymized suppression hashing | **avoid rotation**: changing it forgets all bounced address hashes | Only rotate after confirmed leak; expect bounced addresses to be retried |

---

## Leak Response Procedure

1. **Immediate containment:** Rotate the compromised secret immediately following the table above.
2. **Access audit:** Inspect Vercel runtime logs, Supabase audit logs (`audit_log`), and Resend logs for suspicious activity during the leak window.
3. **Escalation:** If `SUPABASE_SECRET_KEY` was leaked, assume database read exposure. Follow [`docs/runbooks/incident.md`](incident.md) and notify counsel and affected businesses.
