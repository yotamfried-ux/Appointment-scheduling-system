# Personal-data ledger and processing register (from the schema, 2026-10-14)

Source of truth: `supabase/migrations/*`, `modules/*`, `lib/legal/content.ts`. "Role" is the working hypothesis to confirm with counsel: **B** = the business is controller and the platform processor; **P** = the platform is controller. Sensitivity: N normal, S sensitive-risk (may reveal health).

| Data | Where (table.column) | Subject | Why | Role | Sensitivity | Who can read | Lives until |
|---|---|---|---|---|---|---|---|
| E-mail, password hash | `auth.users` (Supabase Auth) | business owner/admin/staff | sign-in | P | N | the person; platform admins (back-office API, MFA) | account purge |
| Display name, phone | `profiles` | business user | contact | P | N | the person, members of their business | account purge |
| Business name, kind, phone, address, slug | `businesses` | business | service | P | N (public: name, address, kind) | public page shows name/address/services | account purge (14-day grace) |
| Accepted terms/privacy version and time | `legal_acceptances` | business user | proof of acceptance | P | N | the person | account purge |
| Customer name, phone, optional e-mail | `customers` | end customer | run the appointment, reminders | B | N | members of that business only (RLS) | until the customer is anonymised or the business is purged |
| Owner notes about a customer | `customers.notes`, `appointments.owner_note` | end customer | CRM | B | possible S (free text) | that business | cleared by customer anonymise |
| Intake answers | `appointments.intake` (jsonb, ≤4 KB) | end customer | optional questions per kind: allergies/sensitivities (beauty, nails), goal incl. "rehabilitation" (trainer), reason for visit (clinic) | B | **S** | that business only; never in mail or calendar files | cleared by customer anonymise |
| Appointment time, service snapshot, price, status, reference | `appointments` | end customer | the booking | B | N (service name may hint at health for clinic kinds) | that business; the customer through a signed private link | stays (de-identified) after anonymise; deleted with the business |
| Waitlist request (date, window, status) | `waitlist_entries`, `waitlist_offers` | end customer | waitlist | B | N | that business; customer via signed link | closed on anonymise; deleted with the business |
| Delivery record of mail | `notification_log` (type, status, attempts, **hash** of address, no body) | end customer / owner | delivery and retries | B/P | N | system only | with the business |
| Suppression list | `email_suppressions` (hash of address, reason) | anyone who bounced/complained | stop mailing | P | N (hash only) | system only | indefinite (a suppression must outlive the data it protects: decision needed) |
| Audit trail | `audit_log` (actor uuid, action, entity id, counters; no personal fields) | business user | accountability | P | N | members (their business) | append-only, kept; purge writes `account.purged` |
| Idempotency, rate counters, token uses, job runs, domain events | `booking_idempotency`, `rate_counters`, `token_uses`, `job_runs`, `domain_events` | technical | abuse and retry control | P | N (may hold request hashes) | system only | 1 to 90 days (maintenance job) |
| Subscription state, billing events | `subscriptions`, `billing_events` | business | access to features | P | N | members; platform admins | with the business |
| Server logs | Vercel runtime logs | visitors | operations | P | N (code logs fixed event words and request ids; no bodies) | operator | Vercel plan retention (**unknown**) |
| Cookies | `sb-…-auth-token` (HttpOnly), `tori_consent`, theme in localStorage | visitor/owner | session, preference | P | N | browser | session / 180 days |

Facts verified in code: customers have a unique phone per business; anonymise sets name to a fixed word, e-mail and notes to null, replaces the phone with a generated one, clears `appointments.intake` and `owner_note`, closes waitlist requests, writes an audit row (`20261018000000_customers_reports.sql`). Business purge deletes the business (cascade) and the `auth.users` rows of its members (`20261028000000_purge_removes_identity.sql`), tested in `140_account_lifecycle.test.sql`.

Not tested / unknown: contents of Supabase automatic backups and their retention; Vercel log retention; whether support exports ever exist outside the system (none are produced by the product).
