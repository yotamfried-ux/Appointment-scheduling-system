# Security & operations qualification report (docs/05 §12)

Scope: the application at the commit that contains this file (see "Evidence is for" below). Statuses: **PASS** (evidence run, exit status 0) · **FAIL** · **PARTIAL** · **BLOCKED** (needs something outside the code) · **NOT TESTED**. Nothing here claims the system is "secure"; it records what was tried and what happened.

## 1. Automated verification (local, real exit codes)

| Check | Result | Notes |
|---|---|---|
| ESLint (incl. the exact `system-db` import allow-list) / TypeScript | PASS | 0 errors (1 pre-existing warning in a test) |
| Unit (vitest) | PASS | 476 tests |
| Database (pgTAP) | PASS | 12 files, 671 checks; `private.lint_violations()` empty |
| Production build with the `check:env` gate wired in | PASS | the gate runs only when `VERCEL_ENV=production` |
| Client-bundle secret scan + canary (`SUPABASE_SECRET_KEY` value grepped) + planted-secret negative control | PASS | |
| Gitleaks (full history, as CI runs it) | PASS | 5 invented fixture values in a unit test recorded in `.gitleaksignore` |
| Full Playwright (desktop + mobile-360, axe WCAG 2.2 AA) | PASS | 457 passed, 1 skipped (pre-existing) |
| CodeQL, osv-scanner, trivy, gitleaks in CI | see `stage-11.md` (per job, per SHA) | |

## 2. Authorisation and tenancy (docs/05 §12.4)
| Item | Result |
|---|---|
| Permission matrix: every owner/admin/back-office route × {anonymous, wrong tenant, staff, admin, owner, platform admin without MFA, with MFA} | PASS (`permission-matrix.spec.ts`; includes a self-check that every route file is in the matrix) |
| Tenant isolation at the database (RLS forced, no anon grants, definer functions only in `private`) | PASS (pgTAP 010–110) |
| Customer capability tokens: single use, scoped, forged/expired/unknown indistinguishable | PASS |
| Per-role export gate, audit before data leaves | PASS |

## 3. Findings of the independent security review, and what was done
A review of the whole system was run as a separate pass. Each finding was **verified against the code before acting**; severity is the reviewer's, disposition is mine.

| Finding | Verified | Disposition |
|---|---|---|
| Booking with an existing phone rewrote the stored customer name/e-mail (identity takeover → mail redirected to attacker) | yes | **Fixed.** The customer row is never rewritten by an unauthenticated booking; the e-mail used for a booking is a per-appointment snapshot; erasure clears it. pgTAP 110 + E2E |
| Waitlist replay by phone returned the victim's private manage link | yes | **Fixed.** The link is returned only to the caller that proves ownership (hash of its `Idempotency-Key`); E2E exploit test; negative control: without the proof the link is absent |
| Direct `service_role` writes to protected tables; audit log truncation | yes | **Fixed** (grants revoked, TRUNCATE blocked); pgTAP |
| Billing reason and note changes unaudited; far-future billing events accepted; `entitlement_limit` override without a number | yes | **Fixed**; pgTAP |
| Outbox claim had no lease/backoff/attempt cap | yes | **Fixed** (lease, backoff, stop at 15 attempts → visible in health); pgTAP |
| Staff could page the bulk-export function | yes | **Fixed** (manager + plan gate in the function); pgTAP |
| Dev defaults depended on `VERCEL_ENV` only | yes | **Fixed**: `isProductionLike()` (also `NODE_ENV=production`); E2E server opts out explicitly; `check:env` refuses the opt-out; `build` runs `check:env` on production deploys |
| Bundle scan only matched patterns | yes | **Fixed**: CI plants a canary key and greps for its value |
| Export had no range cap and no cross-site guard | yes | **Fixed**: ≤3 years; `Sec-Fetch-Site: cross-site` refused |
| Unbounded JSON body, 80+ char names, junk slugs reaching the limiter | yes | **Fixed** (64 KiB cap; name ≤80; slug shape checked first) |
| A third party's inbox could be flooded via our booking/waitlist forms | yes | **Fixed**: per-address limit (8/hour), E2E negative control |
| Session cookies lacked `Secure` | yes | **Fixed** (set when production-like) |
| `system-db` allow-list was directory-wide | yes | **Fixed**: exact files |
| Workflow checkouts kept credentials | yes | **Fixed** (`persist-credentials: false`) |
| Staff see revenue in reports | yes | **Accepted, product question** — listed in launch checklist |
| No re-authentication step-up for sensitive owner actions | yes | **Open gap (documented)**; MFA exists, step-up does not (D17) |
| Client IP trusted from `X-Forwarded-For` | yes | **Deployment note:** correct only behind Vercel's proxy; documented in `secrets.md` |
| Lock-order inversion; 5-booking cap race; opening hours not re-checked in SQL; legal gate not enforced on the API; `booking_limit` oracle | yes | **Accepted / documented** — low impact, listed as known limitations |

## 4. Operations (docs/05 §12.7, OPS-xx)
| Item | Result |
|---|---|
| DB-down drill: every endpoint answers within the deadline with a generic 503, no internals in bodies, recovers by itself | PASS (`scripts/drills/db-down.sh`; negative control: without the deadline the endpoints hang) |
| Restore drill: dump → scratch database → counts and invariants equal; sabotage control detected | PASS (`scripts/drills/restore.sh`) — **a drill against the local stack, not against Supabase PITR** |
| `/api/ready`, `/api/jobs/health` (secret-protected) | PASS |
| Load smoke (local, one DB; **a smoke, not a capacity claim**) | PASS — 300 public reads at c=30: all 200 (p50 ≈1.7 s, p95 ≈2.3 s on a shared 4-core box); 60 customers racing for 12 slots: exactly 12 × 201, 48 × 409, no overlap, no 5xx |
| Lighthouse (mobile, booking page) | PARTIAL — after the stage-14 fix: performance 96–98, LCP 2.0–2.5 s (local, simulated throttling; before: 72–86 and 3.8–4.3 s). Not measured on a real device or the production domain |
| External penetration test | **BLOCKED** (needs a third party; B1) |
| Real Supabase PITR restore, real Resend delivery/DMARC, real payment provider | **BLOCKED / NOT TESTED** (accounts needed) |
| Accessibility audit by a person (screen reader) | **NOT TESTED** (B10); axe automation only |

## 5. Not claimed
No claim of legal compliance, WCAG conformance, production capacity, or absence of vulnerabilities. Mock-backed results (fake e-mail, fake billing) are not integration evidence for the real providers.
