# Launch checklist

What is needed before the first real business uses this. **Blockers** stop the launch; **before public** can follow a private beta. Everything the code can do by itself is done and verified (see `docs/evidence/`); what is left needs an account, a payment, a legal opinion or a decision, so it is yours.

Run last, with the production values in the environment: `VERCEL_ENV=production npm run check:env` (fails on a missing secret, a placeholder, a test switch or a fake provider; prints names only).

## A. Blockers

| # | Item | Why it is a blocker | Who |
|---|---|---|---|
| A1 | **Supabase production project** (own project, region, plan with **PITR**), then `supabase db push` of the migrations | nothing runs without it; backups need PITR (OPS-07) | you (cost) |
| A2 | **Vercel project** with Production and Preview env scoped separately (Preview must never hold production keys: OPS-08), **Deployment Protection** on Preview, domain attached | | you |
| A3 | **Cron frequency vs plan:** `vercel.json` schedules every 5 minutes; the free tier allows daily crons only. Choose a paid plan or move the four URLs to another scheduler (runbook `jobs.md`) | reminders and waitlist offers depend on it | you |
| A4 | **Resend:** verified sending domain with SPF, DKIM and DMARC (start `p=none`, move to `quarantine`/`reject` after a clean week), keys and webhook (`email.bounced`, `email.complained` → `/api/webhooks/resend`) | without it mail lands in spam or is refused | you (needs the domain) |
| A5 | **Secrets** in the host: `SUPABASE_SECRET_KEY`, `BOOKING_TOKEN_SECRET` (≥32 random), `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET`, `NOTIFICATIONS_PEPPER`, `APP_URL`, `NEXT_PUBLIC_SITE_URL`; **none** of the `ALLOW_TEST_*` switches | `check:env` enforces | you |
| A6 | **Legal texts** reviewed and replaced by counsel (`lib/legal/content.ts`; versions in `lib/legal/config.ts`), a real contact (`NEXT_PUBLIC_LEGAL_CONTACT`) and an accessibility coordinator (`NEXT_PUBLIC_A11Y_CONTACT`). Texts are drafts today | privacy and consumer law | you + counsel |
| A7 | **Confirm the product policies stage 12 chose for the three P0 gaps** (they are implemented; each is one setting or function to change): reschedule = same service, same window as cancelling, max 3 moves (RSC-01/02); no-show rule = per business `off/warn/require_approval/block`, threshold over 60 days, owner can forgive per customer (BKG-08); account deletion = owner only, name typed, 14-day grace, customers told, then purged (ACC-09). Stage 13 also built RSC-03/04 (change service when moving, owner moves a booking), attendance confirmation and alerts (NSH-01/02/06), the daily digest (NTF-09/11), price modes (CAT-05); what was left out on purpose is decision D24 | P0 in the scenario catalog | you (decide), small changes |
| A8 | **First platform admin** (back-office API only): `insert into platform_admins (user_id) values ('<id>')` for a user who has enrolled MFA | needed to fix a subscription by hand | you |
| A9 | **Merge to `main`**: the PR is a draft against a `main` that holds only planning docs (D19) | nothing is on `main` yet | you |

## B. Before public (a private beta can start without these)

| # | Item | Note |
|---|---|---|
| B1 | **External penetration test**, focused on tenant isolation, capability tokens and billing (docs/05 §12.7) | the automated matrix and four independent code reviews are inputs, not a substitute |
| B2 | **Billing provider** decision (Stripe/Paddle/…): one adapter file; invoices and Israeli VAT (BIL-10) come with it | `manual` works until then |
| B3 | **CAPTCHA** (docs/05 D16): the public booking has per-IP and per-phone limits but no bot challenge. Turnstile needs a Cloudflare account and a CSP exception | decision |
| B4 | **Booking page speed on slow phones:** the page renders its first screen only after the client script runs (Lighthouse mobile 77, LCP 4.2 s simulated). Server-render the first step | measured in `qualification.md` |
| B5 | **Monitoring**: external uptime checks on `/api/ready` and `/api/jobs/health` (bearer), error tracking (Sentry or logs drain) with `request_id`, no PII (OPS-09) | hooks exist, the service does not |
| B6 | **Dependabot** backlog (8 open PRs, 2 with real failures) and enabling the AI review workflow (secret + variable) | `ci-audit-and-gaps.md` G1, G2 |
| B7 | **Retention**: the housekeeping job removes only operational data; customer data is kept until a business erases it. Agree the retention periods stated in the privacy text (docs/05 §14.4) | legal |
| B8 | **Trial e-mails** (T-7 / T-1 days) and payment-failure e-mails: only in-app banners exist | small build |
| B9 | **Supabase Auth settings** in the dashboard: confirm-email on, password policy, MFA enabled, redirect URLs limited to the production domain, SMTP via Resend, rate limits reviewed | not in code |
| B10 | **Accessibility audit** by a person (screen reader on the calendar and slot picker, UX-08); the statement says no external audit has happened | |

## C. Day-one routine
`/api/jobs/health` green · `/api/ready` green · a test booking end to end on the production domain with a real mailbox · the dashboard banner shows no undelivered mail · the Supabase advisors (security + performance) show nothing new · write down the restore retention window in `docs/runbooks/restore.md`.
