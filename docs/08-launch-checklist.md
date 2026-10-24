# Launch checklist

What is needed before the first real business uses this. **Blockers** stop the launch; **before public** can follow a private beta. Everything the code can do by itself is done and verified (see `docs/evidence/`); what is left needs an account, a payment, a legal opinion or a decision, so it is yours.

Run last, with the production values in the environment: `VERCEL_ENV=production npm run check:env` (fails on a missing secret, a placeholder, a test switch or a fake provider; prints names only).

## Status 2026-10-23 (closed pilot with the owner's mother)
Done and verified: the code is on `main` and deployed (`turim.d2ryf.com`, `/api/ready` 200, no runtime errors), customer identity is the e-mail address, the customer's link shows only their own appointment, the legal gate is enforced on the owner API, Next.js is on 16.4.2 (three advisories closed), the Strix findings are fixed or decided (`docs/evidence/strix-run-2026-10-21.md`), the legal pages are presented as the official texts, and `.github/workflows/jobs.yml` runs the jobs every 5/15 minutes and raises a failed run when the site or a job is unhealthy.
Still the owner's, in this order: **A5** (names only: check them in Vercel), migration `20261046` on the production database (needs the owner's "go"), the Supabase Auth settings (**B9**), the DMARC record (the DNS of `d2ryf.com` is not on Vercel, so it is set at the registrar), the repository secret `CRON_SECRET` for the jobs workflow, the platform admin (**A8**), the plan grant for the pilot business (`docs/runbooks/pilot.md`).

## A. Blockers

| # | Item | Why it is a blocker | Who |
|---|---|---|---|
| A1 | **Supabase production project** (own project, region, plan with **PITR**), then `supabase db push` of the migrations | nothing runs without it; backups need PITR (OPS-07) | you (cost) |
| A2 | **Vercel project** with Production and Preview env scoped separately (Preview must never hold production keys: OPS-08), **Deployment Protection** on Preview, domain attached | | you |
| A3 | **Cron frequency vs plan** (covered for a pilot by `.github/workflows/jobs.yml`, which needs the repository secret `CRON_SECRET`): `vercel.json` is set to **daily** only so that the test project could be created on the free plan; production needs the every-5/15-minute values kept in `docs/runbooks/jobs.md` (restore them, or use another scheduler). Originally it scheduled every 5 minutes; the free tier allows daily crons only. Choose a paid plan or move the four URLs to another scheduler (runbook `jobs.md`) | reminders and waitlist offers depend on it | you |
| A4 | **Resend:** verified sending domain with SPF, DKIM and DMARC (start `p=none`, move to `quarantine`/`reject` after a clean week), keys and webhook (`email.bounced`, `email.complained` → `/api/webhooks/resend`) | without it mail lands in spam or is refused | you (needs the domain) |
| A5 | **Secrets** in the host: `SUPABASE_SECRET_KEY`, `BOOKING_TOKEN_SECRET` (≥32 random), `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET`, `NOTIFICATIONS_PEPPER`, `APP_URL`, `NEXT_PUBLIC_SITE_URL`; **none** of the `ALLOW_TEST_*` switches | `check:env` enforces | you |
| A6 | **Legal texts** reviewed and replaced by counsel (`lib/legal/content.ts`; versions in `lib/legal/config.ts`), a real contact (`NEXT_PUBLIC_LEGAL_CONTACT`) and an accessibility coordinator (`NEXT_PUBLIC_A11Y_CONTACT`). The owner has presented them as the official texts (2026-10-21); counsel's review and the owner's full-name approval sentence in `docs/legal/legal-owner-approval.md` are still open | privacy and consumer law | you + counsel |
| A7 | **Confirm the product policies stage 12 chose for the three P0 gaps** (they are implemented; each is one setting or function to change): reschedule = same service, same window as cancelling, max 3 moves (RSC-01/02); no-show rule = per business `off/warn/require_approval/block`, threshold over 60 days, owner can forgive per customer (BKG-08); account deletion = owner only, name typed, 14-day grace, customers told, then purged (ACC-09). Stage 13 also built RSC-03/04 (change service when moving, owner moves a booking), attendance confirmation and alerts (NSH-01/02/06), the daily digest (NTF-09/11), price modes (CAT-05); what was left out on purpose is decision D24 | P0 in the scenario catalog | you (decide), small changes |
| A8 | **First platform admin** (back-office API only): `insert into platform_admins (user_id) values ('<id>')` for a user who has enrolled MFA | needed to fix a subscription by hand | you |
| A9 | ~~Merge to `main`~~ **Done:** everything is on `main` | | |

## B. Before public (a private beta can start without these)

| # | Item | Note |
|---|---|---|
| B1 | **External penetration test**, focused on tenant isolation, capability tokens and billing (docs/05 §12.7) | the automated matrix and four independent code reviews are inputs, not a substitute |
| B2 | **Billing provider** decision (Stripe/Paddle/…): one adapter file; invoices and Israeli VAT (BIL-10) come with it | `manual` works until then |
| B3 | **CAPTCHA** (docs/05 D16): the public booking has per-IP and per-phone limits but no bot challenge. Turnstile needs a Cloudflare account and a CSP exception | decision |
| B4 | ~~Booking page speed~~ **Done in stage 14:** the first step is server-rendered. Lighthouse mobile (local, simulated): 72–86 → 96–98, LCP 3.8–4.3 s → 2.0–2.5 s. Measure again on the real domain after deploy | `docs/evidence/stage-14.md` |
| B5 | **Monitoring**: `jobs.yml` checks `/api/ready` and `/api/jobs/health` every 5 minutes (a red run e-mails the repository watchers); still missing: error tracking (Sentry or logs drain) with `request_id`, no PII (OPS-09) | hooks exist, the service does not |
| B6 | **Dependabot** backlog (8 open PRs, 2 with real failures) and enabling the AI review workflow (secret + variable) | `ci-audit-and-gaps.md` G1, G2 |
| B7 | **Retention**: the housekeeping job removes only operational data; customer data is kept until a business erases it. Agree the retention periods stated in the privacy text (docs/05 §14.4) | legal |
| B8 | ~~Trial e-mails~~ **Done in stage 14:** trial ending (≤7 days), last day, and payment failed, each once per milestone, skipped if the state changed | `docs/evidence/stage-14.md` |
| B9 | **Supabase Auth settings** in the dashboard (e-mail expiry, sender and Hebrew templates: `docs/runbooks/auth-emails.md`): confirm-email on, password policy, MFA enabled, redirect URLs limited to the production domain, SMTP via Resend, rate limits reviewed | not in code |
| B10 | **Accessibility audit** by a person (screen reader on the calendar and slot picker, UX-08); the statement says no external audit has happened | |

## C. Day-one routine
`/api/jobs/health` green · `/api/ready` green · a test booking end to end on the production domain with a real mailbox · the dashboard banner shows no undelivered mail · the Supabase advisors (security + performance) show nothing new · write down the restore retention window in `docs/runbooks/restore.md`.
