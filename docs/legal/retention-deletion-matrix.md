# Retention and deletion matrix (2026-10-14)

Status words: PASS = behavior proven by a test in this repository; NOT TESTED = no evidence in this session.

| Category | Retention today | What removes it | Evidence | Status |
|---|---|---|---|---|
| Customer identity (name, phone, e-mail, notes) | while the business is active | owner presses "delete personal details" (refused while a future appointment exists); business purge | pgTAP and E2E (`customers` stage 8), `140_account_lifecycle` | PASS |
| Intake answers, owner notes | with the customer | cleared by the same anonymise | `anonymize_customer_impl` | PASS (E2E assertion of the cleared intake: **NOT TESTED** separately) |
| Appointment facts after anonymise | kept without identity so reports stay true | business purge | policy text in privacy draft | PASS |
| Whole business (owner request) | 14-day grace after the owner types the business name, customers are told, then purge incl. members' `auth.users` rows | `maintenance` cron job `purge_deleted_businesses` | `140_account_lifecycle.test.sql`, E2E `account.spec.ts` | PASS |
| Technical rows (rate counters 1 day, token uses 1 day, idempotency 30 days, job runs 30 days, processed domain events 90 days) | listed | `maintenance_run` (daily) | `20261021000000_maintenance.sql`, pgTAP | PASS |
| `notification_log` | with the business (rows hold a hash of the address, no body) | business purge | schema | **PARTIAL: no age-based purge while a business is active** (gap P2) |
| Customer identity of an active business | **3 years after the customer's last activity** (owner decision 2026-10-20) | `retention_anonymize` in the daily maintenance job (same erasure as the owner's "delete personal details"; appointment facts stay without identity) | pgTAP `190_retention` | PASS |
| `email_suppressions` | indefinite (hash) | none | schema | decision needed (a suppression should outlive the customer it protects) |
| `audit_log` | append-only, never deleted | none (`audit_log is append-only` test); holds actor uuid and counters, no personal fields | `010_tenancy`, `110_identity_hardening`, `140_account_lifecycle` | PASS (retention period still a counsel question) |
| Supabase backups | **unknown** | provider plan | none | NOT TESTED |
| Restore after deletion (deleted data reappears from a restore) | **unknown** | runbook `docs/runbooks/restore.md`; logical restore drill script exists (`scripts/drills/restore.sh`); does not model deletions replayed after a restore | PARTIAL |
| Vercel logs | **unknown** | provider plan | none | NOT TESTED |

Copy that must not over-promise: the privacy draft promises only what the table shows (customer detail deletion by the business, de-identified appointment facts kept). It does not say that backups or logs vanish immediately; keep it that way.
