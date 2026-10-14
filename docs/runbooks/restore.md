# Restore from a backup (drilled)

## Production (Supabase)
1. **Prerequisite, before launch:** the project is on a plan with **Point-in-Time Recovery** enabled (Settings → Add-ons / Backups). Without it only the daily snapshot exists. Record the retention window here once chosen: `____ days`.
2. **Decide the target time** (the minute before the incident). Use the `audit_log` and `billing_events` timestamps to find it.
3. **Restore** from the dashboard (Database → Backups → Point in Time). Supabase restores the whole project in place; expect downtime proportional to size.
4. **Verify before announcing** (the same checks the drill runs, against the restored project): row counts on the key tables, `select count(*) from private.lint_violations()` returns 0, RLS enabled and forced on every public table, the overlap constraint on `appointments` exists, a test booking succeeds and is refused when overlapping.
5. **Tell people what was lost**: bookings made between the target time and the incident are gone; customers can be found from outbox e-mail logs and the provider's delivery logs, and re-contacted.

## Rehearsal that needs no cloud (drilled)
`bash scripts/drills/restore.sh` dumps the local database, restores it into a brand-new scratch database and proves the copy: equal row counts in all tables, a content fingerprint, **zero schema-lint violations, RLS enabled and forced, the same policies, functions and triggers, the no-overlap constraint present, no grants to `anon`**. `DRILL_SABOTAGE=1` damages the copy on purpose and must make it fail. Last result: see `docs/evidence/security/qualification.md`.

Limits of the rehearsal: it exercises a logical dump, not Supabase's physical PITR, and it runs on a small dataset. It proves the schema, the data and the security properties survive a restore; it does not measure how long a production restore takes.
