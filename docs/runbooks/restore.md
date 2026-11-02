# Restore from a backup (Production & Rehearsal Runbook)

## Production (Supabase Pro)

1. **Backup Policy & Retention:**
   - The production project (`abhadytskhgwkrlmceew`) is on **Supabase Pro** located in Frankfurt (`eu-central-1`).
   - Daily automated physical snapshots are generated via **WAL-G** (every morning around 06:57 UTC).
   - 8 daily snapshots are retained automatically by Supabase.
   - **RPO (Recovery Point Objective):** up to 24 hours (point-in-time recovery is disabled to adhere to the $0 additional monthly infrastructure budget requirement).
   - **RTO (Recovery Time Objective):** 5–15 minutes for in-place database restoration.

2. **Triggering a Restore:**
   - In [supabase.com/dashboard](https://supabase.com/dashboard) → Project `abhadytskhgwkrlmceew` → Database → Backups → Scheduled Backups.
   - Select the desired daily backup snapshot and click **Restore**.
   - Note: Restoration executes in place. Expect database downtime proportional to instance size.

3. **Post-Restore Verification Checklist:**
   - Verify table row counts across key tables (`businesses`, `services`, `appointments`, `customers`).
   - Verify zero schema lint violations:
     ```sql
     select count(*) from private.lint_violations();
     ```
     Must return `0`.
   - Verify Row Level Security is enabled and enforced:
     ```sql
     select tablename, rowsecurity from pg_tables where schemaname = 'public';
     ```
   - Verify the double-booking exclusion constraint exists on `public.appointments`:
     ```sql
     select conname, contype from pg_constraint where conname = 'no_overlapping_appointments';
     ```
   - Execute a live probe against `/api/health` and `/api/ready` on `https://turim.d2ryf.com`.

4. **Data Reconciliation (Post-Incident Recovery):**
   - Bookings made between the snapshot timestamp (06:57 UTC) and the incident timestamp cannot be restored from the DB image.
   - **Customer & Appointment Recovery:** Query the Resend transaction logs (`from: noreply@mail.d2ryf.com` or `appointments@turim.d2ryf.com`). Every confirmed appointment produced an email with appointment date, time, business, customer name, and customer email.
   - Reconstruct lost appointments and notify affected customers in Hebrew.

---

## Local Automated Restore Drill (Rehearsal)

The automated script `scripts/drills/restore.sh` runs regularly in CI (`drills.yml`):
- Dumps the local PostgreSQL database schema and data.
- Restores it into a brand-new scratch database container.
- Proves:
  - Equal table row counts.
  - Zero schema-lint violations (`private.lint_violations() = 0`).
  - Row Level Security enabled and forced on all tables.
  - All triggers, functions, policies, and constraints (`no_overlapping_appointments`) intact.
  - Zero grants to role `anon`.
