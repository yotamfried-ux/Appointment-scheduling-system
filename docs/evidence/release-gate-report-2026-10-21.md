# Release gate report: the 20 prelaunch checks (2026-10-21)

Source: Engineering-OS `docs/launch-readiness/twenty-checks.md` (discovery list, not authority; official standards take precedence). Revision: `main` at `989e825`, deployed to Production at `https://turim.d2ryf.com` (Vercel `fra1`, Supabase Frankfurt). Status words: PASS, PARTIAL, NOT TESTED, NOT APPLICABLE, NOT GRANTED. A link is not evidence; each row names what was executed. This report does not authorize a release (the owner decides) and never says "secure" or "compliant".

| # | Check | Status | Executed evidence | Still missing |
|---|---|---|---|---|
| 01 | Exposed API keys | PASS | Gitleaks over full history and Trivy secret scan green in CI; client bundle checked for the secret key (`check:bundle`, planted-secret negative control); only the publishable key is public by design | three secret values the assistant generated during setup were shown in the chat; they were never deployed (the host refused to store them) and the owner was told to create new ones. Whether the owner did is not recorded here, so confirm that no production secret equals a value from the chat, and rotate if unsure |
| 02 | Row-level security | PASS | RLS enabled and forced on all 28 tables; pgTAP cross-tenant tests; permission matrix e2e; `private.lint_violations()` empty in CI. **Production project, read-only checks 2026-10-21:** 28 of 28 public tables have RLS enabled and forced, 0 lint violations, 0 grants to `anon` on public tables, 0 SECURITY DEFINER functions in `public`; the Supabase security advisor reports only INFO "RLS enabled, no policy" on 8 system tables that are reached through the service role by design | re-run after the first real business exists |
| 03 | Missing rate limits | PARTIAL | public booking, waitlist, token pages, exports, slug check and login paths are limited and tested; code review 2026-10-21 | Supabase Auth limits on the production project, no CAPTCHA decision (security review item 10) |
| 04 | Database default access | PARTIAL | no grants to `anon`, definer functions only in `private` with empty `search_path`; production: `anon` has no USAGE on schema `private` | the "exposed schemas" setting of the Data API cannot be read from SQL; the owner confirms in the dashboard (Settings, API) that only `public` is exposed. `authenticated` can use `private` by design (the public wrappers call it), so exposing it would be a defect |
| 05 | Unprotected admin routes | PASS | permission matrix over every owner/admin route and caller kind; platform admin needs MFA | none known |
| 06 | Leaked stack traces | PASS (local) | error answers are generic with a request id; probes of unknown routes, bad input, bad tokens, no session and the job endpoints returned no stack, path, vendor name or secret and no `x-powered-by` header; the database-down drill scans every body for leak patterns | none known |
| 07 | Server-side validation | PASS | strict Zod contracts on every route, ownership checks, API contract tests that bypass the UI | none known |
| 08 | Unhandled errors | PASS (local) | error boundary and 404 pages tested; database-down drill: liveness stays 200, readiness answers 503 in about 2 s, APIs answer 503 within the 8 s deadline, no process crash, recovery in about 1 s | the booking page itself answers 500 (not 503) after the 8 s deadline during an outage; acceptable, can be softened |
| 09 | Database-down handling | PASS (local) | `scripts/drills/db-down.sh` 2026-10-21: DRILL OK (see check 08) | outage drill on production is not advisable; the local drill is the evidence |
| 10 | Empty states | PASS (local) | e2e covers zero data, loading, error and no access on owner and public pages | none known |
| 11 | N+1 queries | PASS | database calls per request are pinned by e2e (`owner-speed`) and the growth drill at 800k appointments stays at 2-20 ms per query | none known |
| 12 | Image optimization | NOT APPLICABLE | the product serves no images | revisit if a logo upload is added |
| 13 | Test under load | PASS (local, small) | `scripts/drills/http-load.mjs`, 20 s, 20 concurrent visitors, each with its own address: 2,392 requests, 120 requests/s, 0 server errors; p95 399 ms booking page, 149 ms services, 137 ms availability, 297 ms login; plus the 800k-appointment database drill | not run against production (real customers); a business with a handful of customers needs a small fraction of this |
| 14 | Unnecessary re-renders | PARTIAL | Lighthouse (mobile emulation, local build): total blocking time 80 ms sign-up, 120 ms home, 270 ms booking page; no interaction problem observed in the browser tests | no React profiler session; revisit if a page feels slow on a real phone |
| 15 | Webhook signatures | PASS | mail webhook: HMAC over the raw body, replay window, fail closed; billing webhook: provider adapter verifies, manual adapter rejects all (unit and e2e) | the payment provider's own scheme when Grow is added |
| 16 | No stored card data | PASS (today) | no card field, no payment provider connected; privacy text says so | PCI scope review when Grow is connected |
| 17 | Privacy policy | PARTIAL | text reconciled with the data map; vendors named by category only; contact set; version 2026-10-21 | owner approval (G-10); counsel review is the owner's accepted residual risk (D-10) |
| 18 | Mobile screen size | PASS (emulated) | 360 px and 320 px e2e, 44 px targets, no horizontal scroll; Lighthouse mobile accessibility 100 on home, booking and sign-up | a pass on a real iPhone and Android phone (Q1) |
| 19 | Every button works | PASS (local) / NOT TESTED (production) | user journeys j1-j7 on the local stack, cloud customer path | one real sign-up, booking and cancellation on the production domain with real mail |
| 20 | Prelaunch checklist | NOT GRANTED | this report | explicit go decision by the owner on the exact commit (B9) |

## Lab measurements added 2026-10-21 (local production build, Lighthouse 12, mobile emulation with slow-network throttling)
| Page | Performance | Accessibility | Best practices | LCP | CLS | TBT |
|---|---|---|---|---|---|---|
| Home | 90 | 100 | 100 | 3.4 s | 0 | 120 ms |
| Booking page | 88 | 100 | 100 | 2.9 s | 0 | 270 ms |
| Sign-up | 97 | 100 | 96 | 2.5 s | 0 | 80 ms |
SEO scores 63 on the booking and sign-up pages because they are `noindex` on purpose. LCP above 2.5 s on the throttled lab profile is a target miss, not a field measurement; production runs behind the Vercel CDN in Frankfurt, so re-measure there after launch.

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
