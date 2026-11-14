# Retention and deletion matrix (reconciled 2026-11-14)

Status words: **PASS** = behavior proven by automated migration/unit/pgTAP/E2E test in this repository; **PARTIAL** / **NOT TESTED** = operational gap or infrastructure-dependent verification remaining.

| Category | Retention rule | What removes / anonymizes it | Evidence | Status |
|---|---|---|---|---|
| End-customer identity (name, phone, e-mail, notes, intake) — owner request | While active; immediate erasure upon owner request if no upcoming appointments | `anonymize_customer_impl` ("delete personal details" in customer card) | `20261018000000_customers_reports.sql`, `20261046000000`, pgTAP & E2E `customers.spec.ts` | **PASS** |
| End-customer identity — automatic inactivity retention | **3 years (36 months)** after last activity (`last_activity_at` + no future appointments) | `private.retention_anonymize_impl()` invoked daily via `maintenance` job | `20261037000000_retention_3y.sql`, pgTAP `190_retention.test.sql` | **PASS** |
| De-identified appointment metrics | Retained without personal identifiers so historical revenue/visit reports remain accurate | Deleted permanently on business purge | `20261018000000`, `PRIVACY#retention` | **PASS** |
| Whole business account deletion | **14-day grace period** (future bookings cancelled & customers notified; owner can abort), then permanent hard purge incl. `auth.users` | `maintenance` cron job `purge_deleted_businesses` | `20261028000000_purge_removes_identity.sql`, pgTAP `140_account_lifecycle.test.sql`, E2E `account.spec.ts` | **PASS** |
| `notification_log` | **90 days** after creation for finished rows (`sent`, `skipped`, `dead`) while business is active; immediate cascade on business purge | `private.maintenance_impl()` daily cleanup | `20261040000000_notification_log_retention.sql` | **PASS** |
| Technical rows (`rate_counters` 1d, `token_uses` 1d, `booking_idempotency` 30d, `job_runs` 30d, `domain_events` 90d) | 1 to 90 days | `private.maintenance_impl()` daily cleanup | `20261021000000_maintenance.sql`, `20261040000000`, pgTAP | **PASS** |
| `email_suppressions` | Indefinite hashed suppression record | None automatic (required to avoid re-mailing opted-out/bounced addresses) | Schema `20261016000000` | **DECISION / COUNSEL REVIEW** |
| `audit_log` | Append-only ledger (actor UUID & action metadata, zero customer PII) | Append-only rule | `010_tenancy`, `110_identity_hardening`, `140_account_lifecycle` | **PASS** (retention horizon for counsel) |
| Cloud backups (Supabase) & Vercel logs | Provider plan retention | Automated rolling expiry on provider platform | `docs/runbooks/restore.md`, `scripts/drills/restore.sh` | **PARTIAL / OWNER_ACTION** (production PITR restore + re-deletion drill `LR-08` scheduled) |

**Truthfulness rule**: Public privacy and DPA copy (`lib/legal/content.ts`, version `2026-11-14`) states that deleted data may persist in encrypted provider backups until automatic expiry and does not promise instantaneous erasure from immutable historical backups.
