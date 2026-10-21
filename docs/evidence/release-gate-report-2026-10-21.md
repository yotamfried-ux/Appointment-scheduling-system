# Release gate report: the 20 prelaunch checks (2026-10-21)

Source: Engineering-OS `docs/launch-readiness/twenty-checks.md` (discovery list, not authority; official standards take precedence). Revision: `main` at `989e825`, deployed to Production at `https://turim.d2ryf.com` (Vercel `fra1`, Supabase Frankfurt). Status words: PASS, PARTIAL, NOT TESTED, NOT APPLICABLE, NOT GRANTED. A link is not evidence; each row names what was executed. This report does not authorize a release (the owner decides) and never says "secure" or "compliant".

| # | Check | Status | Executed evidence | Still missing |
|---|---|---|---|---|
| 01 | Exposed API keys | PASS | Gitleaks over full history and Trivy secret scan green in CI; client bundle checked for the secret key (`check:bundle`, planted-secret negative control); only the publishable key is public by design | rotate any key that was ever pasted into a chat or ticket (the owner confirmed none was reused) |
| 02 | Row-level security | PASS | RLS enabled and forced on all 28 tables; pgTAP cross-tenant tests; permission matrix e2e; `private.lint_violations()` empty in CI | re-run against the production project after the first real business exists |
| 03 | Missing rate limits | PARTIAL | public booking, waitlist, token pages, exports, slug check and login paths are limited and tested; code review 2026-10-21 | Supabase Auth limits on the production project, no CAPTCHA decision (security review item 10) |
| 04 | Database default access | PARTIAL | no grants to `anon`, definer functions only in `private` with empty `search_path` (migration text and lint) | confirm in the production dashboard that the Data API exposes only `public` |
| 05 | Unprotected admin routes | PASS | permission matrix over every owner/admin route and caller kind; platform admin needs MFA | none known |
| 06 | Leaked stack traces | PARTIAL | error answers are generic with a request id (API tests, code review) | a production fault-injection pass |
| 07 | Server-side validation | PASS | strict Zod contracts on every route, ownership checks, API contract tests that bypass the UI | none known |
| 08 | Unhandled errors | PARTIAL | error boundary and 404 pages tested; routes answer 503 with a retry hint when the database stalls | alerting on errors with a synthetic failure |
| 09 | Database-down handling | PARTIAL | database timeout drill locally: 503, no hang; documented in the runbooks | outage drill on production |
| 10 | Empty states | PASS (local) | e2e covers zero data, loading, error and no access on owner and public pages | none known |
| 11 | N+1 queries | PASS | database calls per request are pinned by e2e (`owner-speed`) and the growth drill at 800k appointments stays at 2-20 ms per query | none known |
| 12 | Image optimization | NOT APPLICABLE | the product serves no images | revisit if a logo upload is added |
| 13 | Test under load | PARTIAL | database growth drill, availability engine speed test, cloud speed pass | a representative HTTP load test at the target volume; target is a first customer with one business, so a small run is enough |
| 14 | Unnecessary re-renders | NOT TESTED | not material at this size | profile if a page feels slow on a phone |
| 15 | Webhook signatures | PASS | mail webhook: HMAC over the raw body, replay window, fail closed; billing webhook: provider adapter verifies, manual adapter rejects all (unit and e2e) | the payment provider's own scheme when Grow is added |
| 16 | No stored card data | PASS (today) | no card field, no payment provider connected; privacy text says so | PCI scope review when Grow is connected |
| 17 | Privacy policy | PARTIAL | text reconciled with the data map; vendors named by category only; contact set; version 2026-10-21 | owner approval (G-10); counsel review is the owner's accepted residual risk (D-10) |
| 18 | Mobile screen size | PASS (emulated) | 360 px and 320 px e2e, 44 px targets, no horizontal scroll | a pass on a real iPhone and Android phone (Q1) |
| 19 | Every button works | PASS (local) / NOT TESTED (production) | user journeys j1-j7 on the local stack, cloud customer path | one real sign-up, booking and cancellation on the production domain with real mail |
| 20 | Prelaunch checklist | NOT GRANTED | this report | explicit go decision by the owner on the exact commit (B9) |

## Additional mandatory areas (twenty-checks.md)
| Area | Status | Note |
|---|---|---|
| Supply chain and SBOM | PASS (new) | CI job "Licences + SBOM" (Security workflow): fails on a strong-copyleft licence (negative control run: a deliberate rule failed the job), produces a CycloneDX SBOM artifact kept 90 days. Production dependencies: MIT, Apache-2.0, ISC, BSD, 0BSD, MPL-2.0 (lightningcss, build tool), LGPL-3.0 (sharp-libvips, unmodified prebuilt binary used by the image optimizer), CC-BY-4.0 (caniuse-lite data), OFL (font). No GPL or AGPL |
| CI permissions | PASS | workflows use `contents: read`; actions pinned to SHAs; the review job only runs for same-repo pull requests |
| Backups and restoration | PARTIAL | see check 09 and `docs/runbooks/restore.md`; point-in-time recovery not enabled or drilled |
| Monitoring | PARTIAL | health/ready endpoints and job heartbeats; alerts not yet tested with a synthetic failure |
| Deletion requests | PASS | owner export and deletion with 14-day grace, customer anonymization, 3-year automatic purge, all tested |
| User-generated content moderation | NOT APPLICABLE | the only free text is business names, service names and customer notes shown to the same business; no public posting |
| Consent and child safety | PASS (today) | no trackers; terms and privacy cover bookings for a minor by a parent |
| Release signing | NOT APPLICABLE | web only |
| Data migrations and rollback | PARTIAL | forward-only migrations; rollback is a Vercel rollback plus a restore; rehearsal pending (B8) |

## Legal workstreams (Engineering-OS `docs/legal-compliance/review-matrix.md`)
Applicability recorded in [../legal/legal-qualification.md](../legal/legal-qualification.md) and [../legal/open-decisions.md](../legal/open-decisions.md): privacy law and Amendment 13 (G-05, G-07, G-15), consumer law (G-08, G-13), accessibility (G-11), standard form contracts (G-14), marketing section 30A (G-09, G-16), incident response (runbook), copyright and moderation (not applicable), payments (not live). Every row is engineering issue-spotting; the owner carries the residual risk by decision D-10.
