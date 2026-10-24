# Decisions and gaps before a real production launch (updated 2026-10-24)

Owner: the owner of D2R (the only person who runs the system). This file is the single list of what is decided, what is built, and what must still be closed **before the product takes real customers in production**. It is engineering evidence, not legal advice; it approves nothing. Status words: DECIDED, BUILT, GAP (must close before production), LATER (after launch), TO DECIDE.

## A. Decided by the owner on 2026-10-20 (and what was done)

| # | Topic | Decision | Built / where |
|---|---|---|---|
| D-01 | Operator | The company is called **D2R**. No tax file opened yet; the owner will open one later | name shown on privacy and terms pages (`lib/legal/config.ts`, `components/legal/operator.tsx`); registration details are gap G-01 |
| D-02 | Markets | Israel only. EU/UK/US targeting: none | `legal-qualification.md` |
| D-03 | Payments | Future provider: **Grow**. Not live. Prices shown to customers are display only; no platform payment | privacy and terms name Grow as the future card processor; billing stays manual/fake until chosen and contracted (G-08) |
| D-04 | Marketing e-mail | Marketing only with a separate, explicit, unticked opt-in plus acceptance of the terms; none is sent today | privacy section "הודעות שיווקיות"; consent storage and unsubscribe are built when the first marketing message is built (G-09) |
| D-05 | Retention | Customer personal details removed **3 years after the customer's last activity** | built: migration `20261037000000_retention_3y.sql`, daily in `/api/jobs/maintenance`, pgTAP `190_retention`; privacy text updated |
| D-06 | Sensitive fields | **Not collected** | built: all sensitive intake fields removed from every business kind (`modules/tenancy/business-kind.ts`), unit test fails if one returns; privacy and terms forbid sensitive data in notes |
| D-07 | Server region | Fast for Israeli users | Vercel functions moved to `fra1` (Frankfurt) in `vercel.json`. The database must be in Frankfurt too (G-04) |
| D-08 | Incident roles | One person (the owner) holds every role; everything must reach the D2R mailbox | `docs/runbooks/incident.md`; the mailbox is gap G-02 |
| D-09 | Business roles | The owner does everything | no separate roles to name |
| D-10 | Legal texts | Drafted fully by engineering using the Engineering-OS legal library, no lawyer retained | privacy (12 sections), terms (16 sections incl. processing terms for the business's customers' data), cookies, accessibility; versions `2026-10-20` (owners must re-accept). The "draft" banner was removed on 2026-10-21 on the owner's instruction (G-10; `legal-owner-approval.md`) |

Note on D-10: the library says generic drafts are not a substitute for legal review and that an AI cannot sign off a legal text. The owner chose to proceed without counsel; the consequence is that the owner, as the responsible human, approves the texts (G-10) and accepts the residual risk. Clauses a lawyer normally writes (liability cap, indemnity, governing law and forum, subscription cancellation) are in the terms in their common form; they are the first thing to review if a lawyer is ever involved.

## Status of every gap (2026-10-24)

OPEN = nothing done. PARTIAL = built or started, something remains. WAITING = only the owner can act. DONE = closed. "In progress" items are being built right now and are not merged.

| ID | Status | What remains |
|---|---|---|
| G-01 | WAITING | tax file and registration details |
| G-02 | DONE 2026-10-24 | `d2r.yotam@gmail.com` is set in both Vercel variables (Production and Preview) and shows on the terms and accessibility pages; routing Vercel, Supabase and GitHub alerts to it is still open |
| G-03 | DONE 2026-10-24 | leaked-password protection enabled and confirmed by the security advisor |
| G-04 | PARTIAL | Frankfurt project is live and used; the old Singapore test project still has to be deleted by the owner; confirm the privacy text still says Frankfurt |
| G-05 | WAITING | accept vendor processing terms (Supabase, Vercel, Resend) and record dates |
| G-06 | OPEN | restore drill on production |
| G-07 | WAITING | authority registration / security level check (privacy specialist) |
| G-08 | OPEN | Grow contract and integration (billing is manual; the plan for the pilot business is granted with SQL, see `owner-checklist.md`) |
| G-09, G-16 | OPEN (gated) | nothing promotional may be sent until consent storage and unsubscribe exist |
| G-10 | PARTIAL | owner's full name and approval sentence in `legal-owner-approval.md` |
| G-11 | OPEN | accessibility regulation applicability and external audit |
| G-12 | OPEN | deputy contact, needed at the first paying customer |
| G-13 | OPEN (low) | revisit if businesses charge deposits |
| G-14 | OPEN | re-read the liability cap, indemnity, forum and update clauses; the trial-period cap of zero is the weakest point (see `breach-and-liability-brief.md`) |
| G-15 | OPEN | classification of the database (counsel); controls mapped in `data-security-baseline.md` |
| G-17 | PARTIAL | built; the platform-admin account is optional |
| G-18 | End customers' acceptance of the terms is not recorded | at booking there is only a sentence next to the button (browsewrap). `legal_acceptances` is append-only for owners only. See `breach-and-liability-brief.md` section 1 | me (in progress); owner approves the migration | accept the terms once per customer (not at every booking), store version and time. A migration is needed; it is applied to production only after the owner's explicit approval |
| G-19 | Sign-up and account e-mail through the vendor's own sender (DONE 2026-10-24, see the status table) | the hosted Supabase Auth still uses its default sender, which is rate limited and not branded. Templates in `supabase/templates` and the SMTP settings (Resend) are applied in the Supabase dashboard, not by code | owner | follow section 1 of `owner-checklist.md` (Resend key as the SMTP password, paste the five templates). Cannot be done with the available tools |
| G-20 | Scheduled jobs and their secret | CLOSED 2026-10-24. Jobs run from Vercel Cron (`vercel.json`, daily); `CRON_SECRET` already exists in Vercel (Production and Preview) and Vercel sends it itself. An earlier note that a GitHub secret and a `jobs` workflow were needed was wrong: that workflow does not exist on main | none | the daily frequency means reminders and retries once a morning; revisit with a paid Vercel plan if the pilot needs more |
| G-21 | Notification failures were invisible and one confirmation e-mail failed | production `notification_log` has a `booking_confirmed` e-mail that died with `provider 400`; the dashboard banner said only that one message was not delivered, without customer, type or reason | me (in progress) | find the cause of the provider rejection, show customer, message type and reason in the banner, add tests |
| G-22 | Migration 46 is not applied in production (applied to production 2026-10-24 together with the notification failure-code migration) | the schema in the repository is ahead of production | owner approval, then me | the owner says "run migration 46"; afterwards run the advisors and the database tests against it |
| G-23 | DMARC for the sending domain | e-mail from the product domain can be spoofed without it, and deliverability to large providers suffers | owner (DNS) | add the record; if the domain DNS is managed in Vercel it can be added with the available tools |
| G-24 | Production still holds demo data | demo business rows from the earlier test remain next to the realistic pilot data (services, hours, 60 customers, about 480 appointments marked demo). The MCP database tool hangs on delete | owner | delete in the Supabase SQL editor, or approve a scripted clean-up. Must be done before real customers, because demo customers have no e-mail and would be counted in reports |
| G-25 | Owner feedback not yet simulated end to end | a suite of simulations for every reported problem (waitlist suggestions, closed days, link publication, phone/e-mail hint, undelivered message) | me (in progress) | merge the simulation branch after the waitlist PR; keep it in CI |
| G-26 | Colour is the only signal for busy, free and statuses | the owner dislikes colour-coded status; it is also an accessibility risk (WCAG 1.4.1) | me, after the owner chooses | an artifact with colour-free alternatives (icons, text, shape, position) is being prepared; the chosen direction is then applied everywhere |
| G-27 | The cause of the 400 on the first confirmation e-mail is not proven | production stored only `provider 400`. The sender fix (the Hebrew business name encoded as RFC 2047, with a retry from the plain sender) is live, but nobody checked how Resend renders the encoded name, and the failed row from before the fix stays dead | me, after the next real booking | read the next failure or the delivered mail in Resend; if the name shows as raw `=?UTF-8` text, send non-ASCII names from the plain sender |
| G-28 | Reminders and retries run once a day | Vercel Cron runs daily from `vercel.json`; a booking confirmation is sent at once, but a failed one is retried the next morning and the reminder goes out once a day (about 08:10 Israel time) | owner | acceptable for the pilot; revisit with a paid Vercel plan or an outside scheduler if the mother's business needs more |
| G-29 | Vercel and Supabase settings cannot be read back by the assistant | the Vercel connection answers 403 for listing variables and Supabase Auth settings are changed outside the repository, so the state in the status table comes from reports and from the security advisor, not from a re-read | owner | after the pilot starts, open the Vercel and Supabase dashboards once and compare with `docs/owner-checklist.md` |

| G-18 | DONE 2026-10-24 | PR 38 merged; migration 47 applied to production; acceptance (versions and time) is stored with each booking and waitlist entry, and the browser remembers it |
| G-19 | DONE 2026-10-24 | Custom SMTP (Resend, `noreply@mail.d2ryf.com`, sender name "תורים"), six Hebrew templates, OTP expiry 3600 s and site URL are applied; Resend reports the domain `mail.d2ryf.com` as verified; a live sign-up e-mail was delivered in Hebrew and its button confirmed the account (the test user was deleted). Reported by the assistant that applied the settings; nobody re-checked it independently |
| G-20 | CLOSED | see below |
| G-21 | DONE (code and migration live 2026-10-24) | verify the next real failure shows Resend's own reason; the dead confirmation row from before the fix stays as it was |
| G-22 | DONE 2026-10-24 | migration 46 applied to production, advisors show only the leaked-password warning |
| G-23 | PARTIAL | the owner added `rua=mailto:d2r.yotam@gmail.com` at Namecheap on 2026-10-24; not yet verified (check DMARC Lookup for `d2ryf.com`). After a week of clean reports consider `p=quarantine` |
| G-24 | WAITING | owner |
| G-25 | DONE 2026-10-24 | merged (PR 36); nine simulations, each with a negative control |
| G-26 | PARTIAL | step 1 merged (PR 40): status pills are one quiet outline with a word and an icon, free gaps and attention numbers lose their colour. Step 2 (a summary sentence above the time picker) and step 3 (the gap axis) are in progress |

## B. Gaps to close before production (GAP)

| ID | Gap | Why | Who | How to close |
|---|---|---|---|---|
| G-01 | D2R registration (עוסק פטור/מורשה or company), ID number, address | the privacy law notice must identify the operator; invoices and the payment provider need it | owner | open the tax file; give me the details; I add them to the operator block |
| G-02 | The D2R mailbox | legal contact, accessibility contact, incident alerts, support. `NEXT_PUBLIC_LEGAL_CONTACT` and `NEXT_PUBLIC_A11Y_CONTACT` are placeholders until then | owner | give me the address; set both Vercel variables (Preview and Production); route Vercel, Supabase and GitHub alerts to it |
| G-03 | Leaked-password protection (Supabase Auth) | blocks known-breached passwords; recommended before real owners sign up. The organization is on Pro, so it is available; it is a dashboard switch the tools I have cannot flip | owner | Supabase Dashboard, Authentication, Providers/Password security: enable "leaked password protection" on the production project (needs Pro). Until then the minimum password length and MFA stay the controls |
| G-04 | **IN PROGRESS 2026-10-21**: test database now exists in Frankfurt (`abhadytskhgwkrlmceew`, migrations applied, demo user seeded); Vercel Preview must point to it, then the Singapore project is deleted by the owner after the cloud simulation passes. Original gap: database in Frankfurt (`eu-central-1`) | the test database is in Singapore and the site feels slow because every query crosses continents. Production must not repeat that | owner decides, I build | see [region plan](#c-region-and-speed). Verify before launch that the privacy text ("EU, Frankfurt") matches the real project region |
| G-05 | Supabase and Vercel data-processing terms | accepting the vendors' standard DPAs; Resend too | owner | accept in each vendor console and record the date in `processors-and-transfers.md` |
| G-06 | Restore drill on the production project and backup location | "deleted data comes back from a backup" has to be understood and the backup region known | owner + me | after the production project exists: PITR/backup settings, run `scripts/drills/restore.sh` |
| G-07 | Registration with the Privacy Protection Authority / DPO / security level (Amendment 13) | whether any of it is required depends on thresholds (volume, sensitivity). With no sensitive data and a small start it may not be, but nobody has checked | owner | check the authority's official guidance (links in `legal-qualification.md`) once real volumes are known; record the result. A short consult with a privacy specialist is the safest way to close this |
| G-08 | Grow integration: contract, merchant terms, invoices/tax, refund flow, the real price and cancellation text | billing is fake today | owner + me | before any real charge: contract with Grow, tax registration (G-01), then build and test the provider adapter and update terms section "ביטול והחזרים" |
| G-09 | Marketing consent | to send any promotion: separate unticked opt-in, stored with the terms version and time, working unsubscribe, suppression before every send | me (when the feature exists) | design is in `privacy-rights-workflow.md`; no promotional message may be sent before it is built and tested |
| G-10 | Owner approval of the legal texts and removal of the "draft" banner | DONE 2026-10-21 on the owner's written instruction; the banner is gone. The record `legal-owner-approval.md` still lacks the owner's full name and the formal approval sentence | owner | add the name and sentence to `legal-owner-approval.md` |
| G-11 | Accessibility: external audit, Israeli regulation applicability | the statement says no external audit; whether the regulation binds a small operator is unchecked | owner | check applicability; commission an audit if required; until then do not claim compliance |
| G-12 | Upgrade path for other roles | one person is a single point of failure for incidents | owner | name a deputy or an on-call contact when there is a first paying customer |
| G-13 | Cancellation and "consumer" status of the end customer | internet-transaction cancellation rules might apply to a customer's booking if a business charges a fee | owner | stays low risk while the platform takes no payment; revisit when businesses charge deposits |
| G-14 | Standard form contracts: review of the terms for unfair clauses | the Standard Form Contracts Law (1982) lets a court void unfair terms of a contract written in advance. The terms contain a liability cap, an indemnity from the business, a Tel Aviv jurisdiction clause and a right to update the terms | owner (counsel if ever involved) | the update clause already requires the owner to accept a material change before continuing; keep it that way. Do not add silent unilateral changes, a US-style arbitration or a class-action waiver. Re-read the four clauses against the Engineering-OS legal-compliance guide (docs/legal-compliance) before the first outside customer |
| G-15 | Data Security Regulations 2017: classification of the database and the written documents it may require | the regulations tie duties (access list, written security procedure, incident log, periodic review) to the security level of the database. The level was never assessed | owner + counsel (a privacy specialist consult), me for the paperwork | controls and their evidence are mapped in [data-security-baseline.md](data-security-baseline.md); the classification itself is counsel's call (G-07) |
| G-16 | Marketing: section 30A of the Communications Law | any promotional e-mail or SMS needs prior explicit consent, an opt-out in every message and a record. Operational mail (confirmation, reminder, waitlist offer) is not promotion | me, when the first promotion exists | same gate as G-09: nothing promotional is sent before consent storage, unsubscribe and suppression exist and are tested |
| G-17 | Abuse controls on business publication (Strix VULN-0011) | BUILT 2026-10-22: name screen, operator kill switch, report link (`docs/runbooks/abuse.md`); an operator account with a second factor (platform admin) is still to be set up, the SQL route works meanwhile | owner | create the platform-admin account if you want the API route |

## C. Region and speed

Cause of the slowness (observed): the test database is in Singapore (`ap-southeast-1`) and the app's functions ran in the USA (`iad1`/`pdx1`), so each page makes several database round trips of roughly 200 ms each. This is why "the site is slow".

Fix, in order:
1. Done in code: functions run in Frankfurt (`fra1`), the closest Vercel region to Israel.
2. Needed: the database in Frankfurt too. Supabase has no Israeli region; Frankfurt (`eu-central-1`) is the nearest. Server and database in the same city make each query a few milliseconds.
3. For the test environment this means a new Supabase project in `eu-central-1` (a project's region cannot be changed). It costs nothing in data (the test environment only holds synthetic demo data) but needs: the new project, `db-push-test` run against it, the demo seed run, and replacing four values (project URL, publishable key, secret key, project ref) in Vercel Preview and in the GitHub secrets. Nothing from the old project is needed afterwards.
4. After that: measure with the cloud simulation (`/book/demo-barber` time to first byte) and set a target in the launch gates (suggested: under 600 ms to first byte for booking and dashboard from Israel).
5. Production uses the same region from day one, so there is no later migration.

## D. Nothing else needs a decision today

All remaining legal questions in [legal-qualification.md](legal-qualification.md) section 4 are either answered above, or are gaps G-07 (authority registration) and G-11 (accessibility), which depend on facts that do not exist yet.
