# Evidence — Stage 11: hardening and release readiness

Plan: docs/03 §8 (Stage 11) · qualification: `docs/evidence/security/qualification.md` · owner-only items: `docs/08-launch-checklist.md`. Evidence is for the commit that contains this file.

## What was built
- **Operations:** `/api/ready` (DB reachable), `/api/jobs/health` (cron-secret protected heartbeat summary), maintenance job with retention (operational data only), DB deadline (8 s) → generic 503 + error pages, `check:env` production gate (also run by `npm run build` on a production deploy), `robots.txt`, runbooks (`docs/runbooks/*`), launch checklist.
- **Drills (scripts, with negative controls):** database-down and restore.
- **Tests:** permission matrix over every owner/admin/back-office route; load smoke (300 reads at c=30; 60 customers race for 12 slots).
- **Independent security review → fixes** (identity takeover, waitlist link leak, grants/audit/lease hardening, production-like env lockdown, export/body/rate limits, `Secure` cookies, exact `system-db` allow-list, canary bundle scan, workflow credential hygiene). Dispositions per finding: `qualification.md` §3.

## Results
| Layer | Result |
|---|---|
| Lint / typecheck / build / bundle scan (with canary) / Gitleaks | PASS (exit 0 each) |
| Unit (vitest) | PASS — 476 |
| DB (pgTAP) | PASS — 671 checks in 12 files; `private.lint_violations()` empty. New: `100_maintenance`, `110_identity_hardening` (takeover attempt leaves the victim's row and mail routing untouched; waitlist ownership proof; erasure clears per-appointment addresses; service_role cannot write protected tables or truncate the audit log; far-future billing event refused; outbox lease/backoff/15-attempt stop; lint negative control) |
| Full Playwright (desktop + mobile-360) | PASS — 457 passed, 1 skipped (pre-existing), exit status 0. Includes the new exploit tests: identity takeover by phone, waitlist link replay, per-address mail flood (each with its negative control) |

## Found and fixed while verifying
- Existing tests encoded the old (vulnerable) behaviour — "a returning phone updates the stored name" and a fixture address reused across tests — and were rewritten to assert the new contract; per-address mail limits got a test-only scope so fixtures do not share a budget.
- Local Gitleaks flagged invented placeholder values in the env-gate unit test; recorded as false positives with fingerprints (no secret material).
- Earlier in the stage: unused `@ts-expect-error`; `robots.txt` was redirected by the proxy; the DB-frozen drill exposed hanging endpoints (→ deadline, 503, error page); the restore drill needed a scratch database with `public` dropped and tolerance for 6 expected default-privilege errors.

- One walk-in test (`owner-dashboard.spec.ts:47`) failed once in about six isolated repeats and passed in the final full run; the cause was not isolated (not related to this change as far as I could tell), so it was recorded as intermittent. **Cause found and fixed in stage 13** (it clicked "add" before the chosen day was loaded; see `stage-13.md`).

## Known limitations (not claimed)
See `qualification.md` §3–§5 and `docs/08-launch-checklist.md`: no external pentest, no real PITR/Resend/billing-provider evidence, no screen-reader audit, booking page Lighthouse mobile 77 (B4), no re-authentication step-up, RSC-01/02, ACC-09, BKG-08 still open product gaps.

- CI result (checked on GitHub): `1557904` and `252374d`: Gitleaks **failed** (invented fixture values in a unit test; then a fixed canary value I had committed to the workflow) — both fixed (random per-run canary, false positives fingerprinted). `8ecdc4b`: all jobs green — Lint·Types·Unit·Build, DB (migrations·pgTAP·lint), E2E (Playwright mobile+desktop·axe), CodeQL, Gitleaks (full history), OSV-Scanner, Trivy; the AI `review` job is skipped (not enabled).
