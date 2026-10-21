# What is left before production (2026-10-21)

Status of the product: it works end to end on the cloud test environment (Frankfurt database, Vercel Preview in `fra1`): customer booking, manage and cancel, owner agenda, team, settings, owner sign-in (cloud simulation, last full pass `39559715976`, speed pass `39567997254`). This file lists what stands between that and a real launch. It supersedes the "Open" rows of [gap-table-2026-10.md](gap-table-2026-10.md) and the launch gates in [../evidence/launch-readiness.md](../evidence/launch-readiness.md), which stay as the detailed evidence. The decision to launch is the owner's; the current decision is **NO_GO** until the blockers (B) are closed.

Who: **Owner** = needs a decision, an account, a payment or a signature only the owner can give. **Eng** = I can do it. **Both** = I prepare, the owner confirms.

## B. Blockers (nothing public until these are closed)
| # | Area | What is missing | Who | Notes |
|---|---|---|---|---|
| B1 | Operator | D2R tax registration (עוסק פטור/מורשה or company), registration number, address | Owner | then Eng fills the operator block; needed by the privacy notice, invoices and Grow |
| B2 | Mailbox | the D2R address: legal contact, accessibility contact, support, all alerts | Owner | set `NEXT_PUBLIC_LEGAL_CONTACT` and `NEXT_PUBLIC_A11Y_CONTACT`; route Vercel, Supabase, GitHub alerts to it |
| B3 | Production database | a production Supabase project in Frankfurt (separate from test), backups/PITR decision, leaked-password protection switched on (available on Pro) | Both | Owner creates/approves cost; Eng runs migrations, seed of plans, and the restore drill |
| B4 | Production hosting | Vercel Production project, domain, DNS, TLS, canonical host; Production environment variables (`BOOKING_TOKEN_SECRET`, `CRON_SECRET`, `APP_URL`, `NEXT_PUBLIC_SITE_URL`, mail keys); Supabase auth redirect allow-list for the domain | Both | `npm run check:env` already refuses test switches in a Production build |
| B5 | Real e-mail | mail provider account, sending domain with SPF/DKIM/DMARC, a real confirmation, reminder and password reset delivered | Both | today the fake provider is used; real mail is NOT TESTED |
| B6 | Legal texts | the owner reads and approves privacy and terms (names, date, version in `docs/legal/legal-owner-approval.md`), then the "draft" banner is removed (done 2026-10-21 on the owner's instruction; name and sentence still to be added to the record) | Owner | texts are drafted from the Engineering-OS library; no lawyer was retained by decision; the owner carries the residual risk |
| B7 | Cron on a production plan | reminders, waitlist and outbox jobs run every few minutes in production (the test plan allows daily only); values are in the jobs runbook | Both | needs the paid Vercel plan |
| B8 | Recovery proof | point-in-time restore drill on the production project; a synthetic failure that reaches the alert address; rollback rehearsed once | Both | `docs/runbooks/restore.md`, `incident.md` |
| B9 | Release authorization | explicit go/no-go by the owner on the exact release commit | Owner | |

## P. Payments (Grow), needed before charging anyone
| # | What | Who |
|---|---|---|
| P1 | contract and merchant account with Grow; tax registration (B1) | Owner |
| P2 | real prices and plans (what the trial gives, what each plan includes, what happens at the end of the trial) | Owner decides, Eng configures |
| P3 | provider adapter (checkout, webhooks, refunds), invoices/receipts, subscription disclosures next to the action, cancellation and refund flow, tested end to end | Eng |
| P4 | terms section "ביטול והחזרים" re-checked against the real flow | Both |
Until P1-P4: billing stays manual and the product says so; nothing is charged.

## L. Legal and privacy follow-ups (not blockers for a closed pilot, but before a real launch)
| # | What | Who |
|---|---|---|
| L1 | Privacy Protection Authority: check whether database registration, a DPO or a security classification is required at the expected volume (thresholds depend on volume and sensitivity; no sensitive data is collected) | Owner (a short privacy-specialist consult is the safest way) |
| L2 | accept the vendors' data-processing terms (Supabase, Vercel, mail provider, Grow) and record the date | Owner |
| L3 | accessibility: whether the regulation binds the operator, a manual screen-reader pass, an external audit if required | Both |
| L4 | marketing consent flow (separate unticked opt-in, stored with version and time, unsubscribe) built before the first promotional message | Eng |
| L5 | a register for rights requests (access, correction, deletion) once a real contact exists | Eng |
| L6 | incident roles: a deputy or on-call contact besides the owner | Owner |

## Q. Quality and security evidence
| # | What | Who |
|---|---|---|
| Q1 | manual browser pass on a real phone (iOS Safari, Android Chrome), including the booking page, e-mail links and the owner agenda | Both |
| Q2 | a Lighthouse / Core Web Vitals lab run on the Preview and, after launch, field data | Eng |
| Q3 | an authorized dynamic security scan (DAST) of the Preview | Eng |
| Q4 | licence/SBOM check added to CI | Eng |
| Q5 | rehearse the incident runbook once in staging with synthetic data | Both |
| Q6 | real-traffic load check at the target volume (the database side is done: `scripts/drills/scale.sh`) | Eng |

## U. Product polish (does not block a pilot)
Account menu instead of the raw e-mail in the header; a localized day picker in the owner agenda; one title line on the dashboard; a side summary panel on the desktop booking page; a social preview image (needs a brand asset); stage 16 leftovers (browser tests for step 6, journey 8 and the evidence for decision D26).

## Done since the last list (for the record)
Frankfurt database and functions in `fra1`; speed work (engine 25x, one call for availability, owner context in one read, trimmed messages); database growth work (read policies once per query, report and customers at 800k appointments in 8-20 ms, messages kept 90 days, growth drill and runbook); legal and privacy texts drafted; operator D2R in the pages; retention of 3 years; sensitive fields removed; the booking page used a fixed date (fixed); Server-Timing and the cloud speed test.

## Suggested order
1. Owner: B1, B2, B3 (project and cost), B4 (domain), decisions in P2. These unblock the rest.
2. Eng: B3 migrations on production, B4 variables, B5 mail wiring, B7 cron, then B8 drills.
3. Owner: B6 approval, L1 consult, L2 vendor terms.
4. Both: Q1 phone pass, then a closed pilot with one or two real businesses before opening sign-up. B9 only after the pilot.
