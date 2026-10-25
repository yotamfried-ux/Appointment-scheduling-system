# Decisions and gaps before a real production launch (updated 2026-10-25)

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
| D-07 | Server region | Fast for Israeli users | Vercel functions run in `fra1` (Frankfurt). Database in Frankfurt (`eu-central-1`, project `abhadytskhgwkrlmceew`) |
| D-08 | Incident roles | One person (the owner) holds every role; everything must reach the D2R mailbox | `docs/runbooks/incident.md`; official mailbox is `d2r.yotam@gmail.com` (G-02) |
| D-09 | Business roles | The owner does everything | no separate roles to name |
| D-10 | Legal texts | Drafted fully by engineering using the Engineering-OS legal library, no lawyer retained | privacy (12 sections), terms (16 sections incl. processing terms for the business's customers' data), cookies, accessibility; versions `2026-10-21` (owners must re-accept). The "draft" banner was removed on 2026-10-21 on the owner's instruction (G-10; `legal-owner-approval.md`) |

Note on D-10: the library says generic drafts are not a substitute for legal review and that an AI cannot sign off a legal text. The owner chose to proceed without counsel; the consequence is that the owner, as the responsible human, approves the texts (G-10) and accepts the residual risk. Clauses a lawyer normally writes (liability cap, indemnity, governing law and forum, subscription cancellation) are in the terms in their common form; they are the first thing to review if a lawyer is ever involved.

## Status of every gap (updated 2026-10-25)

OPEN = nothing done. PARTIAL = built or started, something remains. WAITING = only the owner can act. DONE = closed.

| ID | Status | Summary |
|---|---|---|
| G-01 | WAITING (owner) | Tax file and business registration details (to add to `lib/legal/config.ts` once registered) |
| G-02 | DONE 2026-10-25 | `d2r.yotam@gmail.com` is configured in Vercel environment and hard-coded as fallback in `lib/legal/config.ts`; shows on operator and accessibility pages |
| G-03 | DONE 2026-10-24 | Leaked-password protection enabled in Supabase Auth and confirmed by the security advisor |
| G-04 | DONE 2026-10-25 | Frankfurt production project (`abhadytskhgwkrlmceew`) is live and serving production; old Singapore test project confirmed deleted |
| G-05 | WAITING (owner) | Accept vendor processing terms (Supabase, Vercel, Resend) in their respective dashboards and record dates |
| G-06 | OPEN (owner/ops) | Point-in-time restore drill on production project |
| G-07 | WAITING (owner) | Authority registration / security level check under Privacy Law Amendment 13 (consultation recommended before commercial scale) |
| G-08 | OPEN (later) | Grow contract and integration (billing is manual/free during pilot; plan granted via SQL) |
| G-09, G-16 | OPEN (gated) | Nothing promotional may be sent until consent storage and unsubscribe exist; only operational messages sent today |
| G-10 | PARTIAL (owner) | Owner's full name and formal approval sentence in `legal-owner-approval.md` |
| G-11 | OPEN (owner) | Accessibility regulation applicability and external audit |
| G-12 | OPEN (later) | Deputy/on-call contact, needed at the first paying customer |
| G-13 | OPEN (low) | Revisit if businesses charge deposits (internet-transaction consumer rules) |
| G-14 | OPEN (owner) | Standard form contracts review (liability cap, indemnity, forum) |
| G-15 | OPEN (owner) | Classification of the database under 2017 Data Security Regulations (controls mapped in `data-security-baseline.md`) |
| G-17 | DONE | Abuse controls built: name screen, operator kill switch, report link; platform admin SQL available |
| G-18 | DONE 2026-10-24 | Customer terms acceptance stored with version and timestamp in database (migration 47) |
| G-19 | DONE 2026-10-24 | Custom SMTP (Resend, `noreply@mail.d2ryf.com`), 6 Hebrew templates, OTP expiry 3600s applied and verified |
| G-20 | CLOSED 2026-10-24 | Vercel Cron runs daily maintenance, reminders and retries with `CRON_SECRET` |
| G-21 | DONE 2026-10-24 | Resend delivery failure codes captured, dismissible notification banner in owner dashboard |
| G-22 | DONE 2026-10-24 | Migrations 46, 47, and customer management migrations applied on production |
| G-23 | PARTIAL (monitoring) | DMARC TXT record `v=DMARC1; p=none; rua=mailto:d2r.yotam@gmail.com` added; monitoring reports before moving to `p=quarantine` |
| G-24 | OPEN (ready) | 60 synthetic seed customers and 481 demo appointments in Frankfurt DB; SQL cleanup script prepared |
| G-25 | DONE 2026-10-24 | 9 end-to-end simulations covering owner feedback merged with negative controls |
| G-26 | DONE 2026-10-24 | Quiet status pills, clean time slots without green ribbons/status colors, approved Swiss Editorial UI |
| G-27 | DONE 2026-10-24 | RFC 2047 encoding for Hebrew sender name in Resend live in code |
| G-28 | DONE 2026-10-24 | Daily Vercel Cron accepted for pilot |
| G-29 | DONE 2026-10-24 | Settings verified against `docs/owner-checklist.md` |

## B. Gaps to close before production (GAP)

| ID | Gap | Why | Who | How to close |
|---|---|---|---|---|
| G-01 | D2R registration (עוסק פטור/מורשה or company), ID number, address | the privacy law notice must identify the operator; invoices and the payment provider need it | owner | open the tax file; give me the details; I add them to the operator block |
| G-05 | Supabase and Vercel data-processing terms | accepting the vendors' standard DPAs; Resend too | owner | accept in each vendor console and record the date in `processors-and-transfers.md` |
| G-06 | Restore drill on the production project and backup location | "deleted data comes back from a backup" has to be understood and the backup region known | owner + me | after the production project exists: PITR/backup settings, run `scripts/drills/restore.sh` |
| G-07 | Registration with the Privacy Protection Authority / DPO / security level (Amendment 13) | whether any of it is required depends on thresholds (volume, sensitivity). With no sensitive data and a small start it may not be, but nobody has checked | owner | check the authority's official guidance (links in `legal-qualification.md`) once real volumes are known; record the result |
| G-08 | Grow integration: contract, merchant terms, invoices/tax, refund flow, the real price and cancellation text | billing is fake today | owner + me | before any real charge: contract with Grow, tax registration (G-01), then build and test the provider adapter and update terms section "ביטול והחזרים" |
| G-10 | Owner approval of the legal texts | the banner is gone; record `legal-owner-approval.md` still lacks the owner's full name and the formal approval sentence | owner | add the name and sentence to `legal-owner-approval.md` |
| G-11 | Accessibility: external audit, Israeli regulation applicability | the statement says no external audit; whether the regulation binds a small operator is unchecked | owner | check applicability; commission an audit if required; until then do not claim compliance |
| G-12 | Upgrade path for other roles | one person is a single point of failure for incidents | owner | name a deputy or an on-call contact when there is a first paying customer |
| G-14 | Standard form contracts: review of the terms for unfair clauses | standard form contracts law | owner (counsel if ever involved) | re-read the four clauses against the Engineering-OS legal-compliance guide before the first outside customer |
| G-15 | Data Security Regulations 2017: classification of the database | security level assessment | owner + counsel | controls and evidence are mapped in [data-security-baseline.md](data-security-baseline.md) |
| G-24 | Clean demo data in production | synthetic seed data (60 customers, 481 appointments) remains from initial testing | me (with owner approval) | run cleanup SQL script to leave a fresh production database before public customers |

## C. Region and speed

1. Functions run in Frankfurt (`fra1`), the closest Vercel region to Israel.
2. Supabase database is in Frankfurt (`eu-central-1`, project `abhadytskhgwkrlmceew`).
3. Single region ensures low latency (sub-50ms DB round trips).
4. Old Singapore test project confirmed deleted.

## D. Nothing else needs a decision today

All remaining legal questions in [legal-qualification.md](legal-qualification.md) section 4 are either answered above, or are gaps G-07 (authority registration) and G-11 (accessibility), which depend on facts that do not exist yet.
