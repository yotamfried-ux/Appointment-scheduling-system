# Release Governance & Rollback Runbook (`GATE-25`)

## 1. Governance Architecture & Platform Constraint

- **Repository:** `yotamfried-ux/Appointment-scheduling-system` (`visibility: private`, `default_branch: main`)
- **Platform Constraint ($0 Additional Cost Rule):**
  - Querying GitHub REST API `GET /repos/yotamfried-ux/Appointment-scheduling-system/branches/main/protection` and `GET /repos/yotamfried-ux/Appointment-scheduling-system/rulesets` returns:
    ```json
    {
      "message": "Upgrade to GitHub Pro or make this repository public to enable this feature.",
      "documentation_url": "https://docs.github.com/rest/branches/branch-protection#get-branch-protection",
      "status": "403"
    }
    ```
  - Because the repository is private on a GitHub Free account and the project enforces a strict **$0 additional monthly cost** requirement, GitHub's server-side branch protection rulesets are unavailable without either upgrading to GitHub Pro ($4/mo) or making the proprietary SaaS repository public.

## 2. Compensating Governance Controls (Verified)

To enforce strict production governance without paid GitHub tiers, Tori implements a 4-layer compensating control verified by `node scripts/verify-governance.mjs`:

1. **Mandatory Pull Request + Operator Approval Gate:**
   - All runtime, database, security, and cron changes are developed on feature branches (e.g., PR #50 `a3f3f1a`, PR #51 `42fad00`) and reviewed by **CodeRabbit AI** + **Principal Engineering Audit** before merge.
   - Merging to `main` requires explicit written operator authorization in the release transcript (`"תמזג"` for PR #50; `"מאשר לך להמשיך למה שנשאר"` for PR #51).
2. **10 Mandatory CI & Security Check Suites on Every PR and `main` Commit:**
   - `.github/workflows/ci.yml`:
     1. `DB (migrations · pgTAP · schema lint)`
     2. `Lint · Types · Unit · Build`
     3. `E2E (Playwright · mobile + desktop · axe)`
   - `.github/workflows/security.yml`:
     4. `CodeQL (JS/TS)`
     5. `Secrets (Gitleaks)`
     6. `Dependencies + Config (Trivy)`
     7. `OSV-Scanner`
     8. `Licences + SBOM`
3. **Code Ownership Matrix (`.github/CODEOWNERS`):**
   - Covers all 15 critical paths (`/supabase/migrations/`, `/supabase/tests/`, `/.github/`, `/proxy.ts`, `/next.config.ts`, `/vercel.json`, `/lib/security/`, `/platform/`, `/app/api/jobs/`, `/app/api/admin/`, `/app/api/webhooks/`, `/modules/booking/`, `/modules/tenancy/`, `/docs/05-security-architecture.md`, `/docs/runbooks/`).
4. **Automated Post-Release Code Integrity Verification (`scripts/verify-governance.mjs`):**
   - Verifies that `git diff --name-only 42fad007a70d5c15b87b4761b90745947522a838..HEAD` contains **zero** unauthorized runtime code modifications outside documentation/governance paths.

### Verification Command
```bash
node scripts/verify-governance.mjs
```

---

## 3. Production Rollback Runbook

### 3.1 Instant Application Rollback (Vercel Production)
Every production deployment on `main` is retained as an immutable Vercel deployment with `isRollbackCandidate: true`:
- **Current Production Deployment (Docs + Governance HEAD):** `dpl_EZgUmSr96VmPaMekHr6Wt9NYSdsb` (`fdbde55`)
- **Verified Code Release Deployment (PR #51):** `dpl_J5rXmAkq329HKBHf3jdXesBj2FXW` (`42fad00`)
- **Previous Baseline Deployment (PR #50):** `dpl_5NphQfeFowS4xY6cZqW1sT9vB2mK` (`a3f3f1a`)

**Procedure (< 60 seconds RTO):**
1. Via Vercel Dashboard (`appointment-scheduling-system` -> **Deployments**) or Vercel CLI/API, locate the target deployment with `isRollbackCandidate: true` (e.g., `dpl_J5rXmAkq329HKBHf3jdXesBj2FXW`).
2. Select **Instant Rollback** (or promote alias `turim.d2ryf.com` to the target deployment).
3. Verify `GET https://turim.d2ryf.com/api/health` (`200`) and `GET https://turim.d2ryf.com/api/ready` (`200`).

### 3.2 Git Revert Rollback
If a code change on `main` must be reverted at the source level:
```bash
git checkout -b revert/release-<sha> main
git revert --no-edit <commit-sha>
git push -u origin revert/release-<sha>
gh pr create --title "revert: rollback <commit-sha>" --body "Emergency rollback"
```
Wait for CI checks to pass (or merge immediately during a P1 incident with operator approval) and verify the resulting Vercel Production deployment reaches `READY`.

### 3.3 Database Migration Roll-Forward Policy (Forward-Only)
All 51 PostgreSQL migrations in `supabase/migrations/` are **forward-only** to protect live tenant data (`businesses`, `appointments`, `customers`, `audit_log`):
- **Never** run `DROP TABLE` or destructive down-migrations against `abhadytskhgwkrlmceew`.
- If a newly introduced RPC or policy causes a regression, apply a new forward migration (`supabase/migrations/<timestamp>_fix_<name>.sql`) that restores the previous function body (`CREATE OR REPLACE FUNCTION ...`) or RLS policy definition, test it against local PostgreSQL (`scripts/drills/restore.sh`), and apply via `supabase db push` or Supabase MCP `apply_migration`.

### 3.4 Emergency Kill-Switches
- **Pause Outbound Emails / Cron Jobs:** Rotate or clear `CRON_SECRET` / `RESEND_API_KEY` in Vercel Environment Variables (`Production`), or pause cron execution while preserving incoming bookings in `public.appointments` and queued rows in `public.notification_log`.
- **Suspend a Compromised or Abusive Tenant:** Use the Platform Admin endpoint `POST /api/admin/business/suspension` (requires MFA `aal2` + `platform_admins` membership) to immediately suspend public booking for a specific `business_id` without affecting other tenants.
