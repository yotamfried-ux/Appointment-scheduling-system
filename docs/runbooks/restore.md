# Restore from a Backup — Production & Rehearsal Runbook (`GATE-19`)

## 1. Recovery Architecture & Honest Verification Status

| Recovery Layer | Mechanism | Verification Status | Evidence |
| :--- | :--- | :---: | :--- |
| **Layer 1: Logical Schema, RLS & Data Restore Drill** | `scripts/drills/restore.sh` (`pg_dump` -> clean scratch DB `pg_restore` -> invariant assertions) | **PASS** | Verified in CI (`drills.yml`) and local rehearsal: 47/47 migrations applied (`20261011000000`..`20261058000000`), `private.lint_violations() = 0`, 29/29 tables with `relrowsecurity = true` & `relforcerowsecurity = true`, 3 GiST exclusion constraints (`appointments_resource_id_tstzrange_excl`, `availability_rules_resource_id_weekday_int4range_excl`, `waitlist_offers_one_live_per_person`), zero grants to `anon`. |
| **Layer 2: Live Production Schema & Constraint Parity** | Live SQL inspection of `abhadytskhgwkrlmceew` (`eu-central-1`) | **PASS** | `applied_migrations_count = 47`, `latest_migration_version = 20261058000000`, `forced_rls_tables_count = 29`, `unprotected_public_tables_count = 0`, GiST constraints verified active. |
| **Layer 3: Physical Cloud Snapshot Restore (Supabase WAL-G)** | Daily automated physical WAL-G snapshots on Supabase Pro (`abhadytskhgwkrlmceew`, 8 daily backups retained) | **NOT VERIFIED** *(Requires Operator Decision)* | **Why not executed in live cloud:** In Supabase Pro, restoring a physical WAL-G backup is either an **in-place destructive operation** that overwrites the live Production database (`abhadytskhgwkrlmceew`), or requires provisioning a **second paid Supabase Pro project (~$25/mo)** as a restore target, which violates the operator's hard **$0 additional monthly cost** constraint. Per GATE-19 rules, physical WAL-G restore is explicitly marked **`NOT VERIFIED`** until the operator selects one of the 3 options below. |

---

## 2. Operator Options for Physical WAL-G Restore Verification

Because a physical WAL-G restore cannot be executed in isolation on Supabase without either temporary production downtime or a paid secondary Pro instance, the operator must choose one of the following paths:

- **Option A — Risk Acceptance under $0 Budget (Recommended for Initial Controlled Launch):**
  - Rely on the verified daily WAL-G physical backup existence (8 retained daily snapshots in `eu-central-1`, RPO <= 24h) combined with the automated logical `pg_dump` / `pg_restore` drill (`scripts/drills/restore.sh` in `.github/workflows/drills.yml`) and Resend transactional outbox logs for sub-24h booking reconstruction. Cost: **$0/mo**.
- **Option B — Isolated Physical Restore to a Disposable Pro Project:**
  - Temporarily provision a second Supabase Pro project in `eu-central-1`, use Supabase's "Restore to new project" (Clone) feature from the latest physical snapshot of `abhadytskhgwkrlmceew`, run the post-restore verification checklist against the cloned database, and immediately delete the temporary project. Cost: prorated Supabase Pro compute/plan usage (~$1–$25 depending on billing cycle).
- **Option C — Pre-Launch Maintenance Window In-Place Restore Drill:**
  - Before onboarding external commercial tenants, schedule a 15-minute maintenance window on `abhadytskhgwkrlmceew`, export any delta rows since 06:57 UTC, trigger an in-place physical restore from the latest WAL-G snapshot in the Supabase Dashboard, verify all post-restore invariants, and re-apply delta rows. Cost: **$0**, ~10–15 minutes of database downtime.

---

## 3. Production In-Place Restore Procedure (Supabase Pro)

1. **Backup Policy & Retention:**
   - Project `abhadytskhgwkrlmceew` runs on **Supabase Pro** in Frankfurt (`eu-central-1`).
   - Daily automated physical snapshots are generated via **WAL-G** around `06:57 UTC` (8 daily snapshots retained).
   - **RPO (Recovery Point Objective):** Up to 24 hours from physical snapshot + near-zero for confirmed appointments via Resend transactional logs (`mail.d2ryf.com`).
   - **RTO (Recovery Time Objective):** 5–15 minutes for in-place database restoration.

2. **Triggering a Restore:**
   - Open [supabase.com/dashboard](https://supabase.com/dashboard) → Project `abhadytskhgwkrlmceew` → **Database** → **Backups** → **Scheduled Backups**.
   - Select the target daily snapshot and click **Restore**.

3. **Post-Restore Verification Checklist (Mandatory SQL & HTTP Gates):**
   - Verify migration and RLS parity:
     ```sql
     SELECT
       (SELECT count(*) FROM supabase_migrations.schema_migrations) AS migrations_count,
       (SELECT count(*) FROM private.lint_violations()) AS lint_violations,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true AND c.relforcerowsecurity = true) AS forced_rls_tables,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false) AS unprotected_tables,
       (SELECT json_agg(conname ORDER BY conname) FROM pg_constraint WHERE contype = 'x') AS gist_constraints;
     ```
     Expected: `migrations_count = 47`, `lint_violations = 0`, `forced_rls_tables = 29`, `unprotected_tables = 0`, and all 3 GiST exclusion constraints present.
   - Verify table row counts across `public.businesses`, `public.services`, `public.appointments`, `public.customers`, and `public.waitlist_entries`.
   - Verify live HTTP probes on `https://turim.d2ryf.com/api/health` (`200`) and `https://turim.d2ryf.com/api/ready` (`200`), plus `GET https://turim.d2ryf.com/api/jobs/monitor` (`overall: "healthy"`).

4. **Sub-24h Delta Reconciliation via Resend Outbox Ledger:**
   - Query Resend sent emails (`from: noreply@mail.d2ryf.com`) between the backup snapshot timestamp (`06:57 UTC`) and the incident timestamp.
   - Every confirmed booking, reschedule, cancellation, and waitlist offer generated a structured email containing the appointment reference (`TR-...`), business name, service, date/time, and customer contact details, allowing deterministic reconstruction of any intra-day bookings.
