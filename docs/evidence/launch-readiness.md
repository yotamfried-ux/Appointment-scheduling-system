# Launch readiness (Engineering-OS pre-launch library, applied 2026-10-14)

Library: `capability-registry/release-readiness/*` (PR 299). Target: **web only** (Next.js on Vercel, Supabase). Google Play and Apple App Store: `NOT_APPLICABLE` today (no app exists); sections at the end say what would change. This file does not authorize a release: the decision is the owner's (gate 10).

Revision: branch `claude/optimistic-hypatia-wh3zo3`. Environments: local stack (Playwright, pgTAP), cloud test (Vercel Preview + Supabase `datohhabfakiacvndvle`). Status words: PASS, FAIL, PARTIAL, BLOCKED, NOT TESTED, NOT APPLICABLE.

## 1. The ten minimum evidence gates
| # | Gate | Status | Evidence | What is missing |
|---|---|---|---|---|
| 1 | Scope | PARTIAL | web only, Hebrew/RTL, Israel, no real payments, small businesses (docs/00, docs/evidence/cloud-test-environment.md) | operator identity, production region (owner) |
| 2 | Build | PARTIAL | CI builds the commit that is tested; Vercel builds the same commit; check-env gate refuses test switches in Production | a tagged release artifact for a production deploy (none yet) |
| 3 | Primary task | PASS (cloud, customer side) | cloud simulation on the Preview (GitHub Actions run 38466327951): visitor, customer booking on `demo-barber`, manage page, cancel; the booking row is checked through the product, not mocked. Owner side NOT TESTED in the cloud (needs `CLOUD_OWNER_EMAIL`/`PASSWORD`); owner side PASS locally (E2E user journeys) | owner run in the cloud |
| 4 | Recovery | PARTIAL | duplicate submit, stale action, double click, concurrent last-slot race, token replay, network failure paths are in E2E; logical restore rehearsal (`scripts/drills/restore.sh`) and database-down drill documented in the runbooks | offline/background tests; Supabase point-in-time recovery drill on the production project |
| 5 | Security/privacy | PARTIAL | [../legal/audit-checklist.md](../legal/audit-checklist.md) F, tenant isolation tests, CI scanners green | incident runbook, leaked-password protection, notice completion |
| 6 | Payment/transaction | NOT APPLICABLE | no charging; manual billing, stated in the UI | revisit when a provider is connected |
| 7 | Site metadata | PASS (local) / NOT TESTED (production domain) | sitemap, robots, canonical, Open Graph, titles tested by `tests/e2e/seo.spec.ts` | production domain, Search Console, social preview image |
| 8 | Testing eligibility | NOT APPLICABLE | no store | - |
| 9 | Operation | PARTIAL | `/api/health` and `/api/ready` (now also fails when the booking signing secret is missing), job heartbeat view, runbooks (database, jobs, mail, restore, billing, secrets) | alerts tested with a synthetic failure; named on-call; point-in-time restore drill on the production project; cron frequency (daily on the test plan, A3) |
| 10 | Owner authorization | NOT GRANTED | - | explicit decision by the owner and counsel sign-off on public text |

**Decision: NO_GO for a public launch.** Blockers (library release-block list): no qualified sign-off on binding legal text; operator identity and production environment do not exist yet; point-in-time recovery not drilled on a production project; sensitive intake fields undecided. This is the expected state of a product before its production project exists; it is not a defect list of the code.

## 2. Web checklist (library W1-W26)
| # | Item | Status | Evidence / gap |
|---|---|---|---|
| W1 | domain, DNS, TLS, canonical redirects | NOT TESTED | no production domain; the Preview has a trusted TLS certificate on `vercel.app` |
| W2 | production and staging separated, no test keys or demo endpoints in production | PARTIAL | Preview and Production env scoped separately; `npm run check:env` fails a Production build that carries a test switch or placeholder (unit tests); Preview answers `x-robots-tag: noindex` (seen in the cloud responses) |
| W3 | auth callbacks, e-mail domain, reset and invite links, CORS/origins for the canonical host | PARTIAL | sign-in works on the Preview; links built from the configured address, falling back to the deployment host on Vercel (`appUrl()`, unit-tested); Supabase redirect allow-list is a dashboard setting: owner (B9) |
| W4 | migrations, backups plus restore test, cron, storage ACL, rate limits | PARTIAL | migrations applied by workflow and pgTAP in CI; rate limits tested; logical restore rehearsal exists (`scripts/drills/restore.sh`); **point-in-time restore on the production project NOT TESTED**; no file storage in the product |
| W5 | deliverability (SPF/DKIM/DMARC; delivered confirmation and reset) | NOT TESTED | mail provider not live (A4); fake provider in test |
| W6 | health, alerts, escalation, rollback | PARTIAL | health and readiness verified in the cloud (including after the readiness fix); alerts and rollback rehearsal not done |
| W7 | crawlable public pages, private pages not indexable | PASS (local) | `seo.spec.ts`; private pages are behind login or noindex; robots lists the public set |
| W8 | rendering | PASS | server-rendered Hebrew content |
| W9 | titles, description, h1, no invented claims | PASS | one h1, description, no prices or invented numbers (`landing.spec.ts`) |
| W10 | canonical | PASS (local) | each public page has a canonical path (`seo.spec.ts`); absolute host comes from `metadataBase` (set `NEXT_PUBLIC_SITE_URL` in Production) |
| W11 | sitemap | PASS (local) | `/sitemap.xml` with absolute public URLs only; submit in Search Console after the domain exists |
| W12 | robots | PASS | `robots.txt` intentional, points at the sitemap; not used as access control |
| W13 | structured data | NOT DONE (decision) | nothing true and visible to mark up beyond the product name; add only facts a visitor can see |
| W14 | Search Console | NOT TESTED | needs the production domain |
| W15 | localization | PASS (Hebrew/RTL), English NOT APPLICABLE | `lang="he" dir="rtl"`; RTL tests |
| W16 | social previews | PARTIAL | title, description, site name, locale present; **no preview image** (needs a real brand asset: owner/design) |
| W17-18 | Core Web Vitals, Lighthouse | NOT TESTED | no field data and no lab run in this session; library thresholds LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 are targets, not search gates |
| W19 | real flows: signup, deletion, booking state, errors, drops | PASS (local) | user journeys and E2E; cloud customer path PASS |
| W20 | accessibility (keyboard, focus, contrast, RTL, touch, zoom) | PARTIAL | axe WCAG 2.2 AA on public and owner pages, 44 px targets, skip link, reduced motion test; no manual screen-reader pass |
| W21 | PWA | NOT APPLICABLE | no manifest or service worker |
| W22 | server-side authorization per route and tenant, signed webhooks, short-lived tokens | PASS | permission matrix over every owner/admin route and caller kind; RLS forced; webhook signature tests |
| W23 | SAST, SCA, secrets, DAST | PARTIAL | CodeQL, OSV, Trivy, Gitleaks green in CI; no authorized DAST scan run |
| W24 | consent-controlled tracking, notices, export and deletion | PASS / PARTIAL | no trackers (tested); owner export and deletion tested; retention for active businesses undecided |
| W25 | CSRF/XSS/CSP, cookies, abuse limits | PASS | nonce-based CSP, HSTS, security headers (`foundation.spec`), Server Action origin check test, rate limits, HttpOnly session cookie (`consent-cookies.spec`) |
| W26 | accessibility law and reviewer | NOT ASSESSED | counsel |

Common launch defects (library list), checked: staging noindex left in production (Vercel adds it only to Previews: PASS by platform, verify on the production domain); localhost redirects in e-mail or auth (fixed fallback, unit test); private routes in sitemap (test fails if so); success shown before backend confirmation (no); tracker before consent (no tracker); destructive migration (forward-only, pgTAP).

## 3. Universal items worth calling out
| Library item | Status | Note |
|---|---|---|
| 9 functional path incl. deletion | PASS (local) | journeys |
| 11 real test users incl. cross-tenant | PASS | tenancy and permission matrix |
| 14 links in e-mail work end to end | PARTIAL | manage/cancel links tested locally with the fake provider; real mail NOT TESTED |
| 15-16 reproducible builds, tests without hidden skips | PARTIAL | CI runs the whole suite; local-stack specs skip without the stack by design and run in CI |
| 18 migrations with rollback plan | PARTIAL | forward-only migrations; `docs/runbooks/restore.md` |
| 35-40 launch control and observability | PARTIAL | see gate 9 |

## 4. Google Play and Apple App Store (only if a wrapper or PWA is ever shipped)
Not applicable now. If the owner chooses to ship a wrapper, the library says to re-verify the policies on submission day; items that would apply: Play target API level and 16 KB page size, Data Safety form (must match the data map), account-deletion in app and web, store billing classification (a physical service is not digital goods, the SaaS subscription needs a classification decision), reviewer test account and sandbox booking (never real customer data), App Privacy labels, Xcode/SDK currency, TestFlight; and the rule against shipping a static web shell. Nothing was submitted or prepared in a store console.

## 5. Owner-only items (the library's human-only list), unchanged by this pass
Operator entity and accounts; production Supabase project with PITR and region; Vercel Production project and domain; mail domain with SPF/DKIM/DMARC; secrets in the host (`BOOKING_TOKEN_SECRET`, `CRON_SECRET`, `RESEND_*`, `APP_URL`, `NEXT_PUBLIC_SITE_URL`, ...); counsel review of all public text; first platform admin; every release, rollback and publication decision. See `docs/08-launch-checklist.md`.
