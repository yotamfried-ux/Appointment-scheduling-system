# Decisions and gaps before a real production launch (updated 2026-10-21)

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
| D-10 | Legal texts | Drafted fully by engineering using the Engineering-OS legal library, no lawyer retained | privacy (12 sections), terms (16 sections incl. processing terms for the business's customers' data), cookies, accessibility; versions `2026-10-20` (owners must re-accept). The pages still show the "draft" banner; removing it is a deliberate release step (G-10) |

Note on D-10: the library says generic drafts are not a substitute for legal review and that an AI cannot sign off a legal text. The owner chose to proceed without counsel; the consequence is that the owner, as the responsible human, approves the texts (G-10) and accepts the residual risk. Clauses a lawyer normally writes (liability cap, indemnity, governing law and forum, subscription cancellation) are in the terms in their common form; they are the first thing to review if a lawyer is ever involved.

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
| G-10 | Owner approval of the legal texts and removal of the "draft" banner | the pages say draft. The release gate needs a named human to approve | owner | read privacy and terms once, approve in `legal-owner-approval.md` (create it with name, date, version), then remove the banner (`messages/he.json` `legal.draft`) in the release commit |
| G-11 | Accessibility: external audit, Israeli regulation applicability | the statement says no external audit; whether the regulation binds a small operator is unchecked | owner | check applicability; commission an audit if required; until then do not claim compliance |
| G-12 | Upgrade path for other roles | one person is a single point of failure for incidents | owner | name a deputy or an on-call contact when there is a first paying customer |
| G-13 | Cancellation and "consumer" status of the end customer | internet-transaction cancellation rules might apply to a customer's booking if a business charges a fee | owner | stays low risk while the platform takes no payment; revisit when businesses charge deposits |
| G-14 | Standard form contracts: review of the terms for unfair clauses | the Standard Form Contracts Law (1982) lets a court void unfair terms of a contract written in advance. The terms contain a liability cap, an indemnity from the business, a Tel Aviv jurisdiction clause and a right to update the terms | owner (counsel if ever involved) | the update clause already requires the owner to accept a material change before continuing; keep it that way. Do not add silent unilateral changes, a US-style arbitration or a class-action waiver. Re-read the four clauses against the Engineering-OS legal-compliance guide (docs/legal-compliance) before the first outside customer |
| G-15 | Data Security Regulations 2017: classification of the database and the written documents it may require | the regulations tie duties (access list, written security procedure, incident log, periodic review) to the security level of the database. The level was never assessed | owner + counsel (a privacy specialist consult), me for the paperwork | controls and their evidence are mapped in [data-security-baseline.md](data-security-baseline.md); the classification itself is counsel's call (G-07) |
| G-16 | Marketing: section 30A of the Communications Law | any promotional e-mail or SMS needs prior explicit consent, an opt-out in every message and a record. Operational mail (confirmation, reminder, waitlist offer) is not promotion | me, when the first promotion exists | same gate as G-09: nothing promotional is sent before consent storage, unsubscribe and suppression exist and are tested |

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
