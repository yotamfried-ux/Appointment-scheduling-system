# Gap table (UX, legal, security, launch) - 2026-10-14

Sources: UX = Engineering-OS `docs/ui-ux/*`; LEGAL = `docs/legal-compliance/*`; LAUNCH = `capability-registry/release-readiness/*`. "Done" means implemented in this branch and verified by the test named; "Open" is not done.

## P0 - blockers
| Area | Problem | Severity | Fix | Source | Verification | State |
|---|---|---|---|---|---|---|
| Cloud booking | Every booking on the cloud Preview failed: `BOOKING_TOKEN_SECRET` missing; readiness still said "ready" | critical | readiness now fails without it (names only); owner added the variable | LAUNCH W6, W22 | cloud simulation: customer booking, manage, cancel PASS (run 38466327951); unit test `missingServerConfig` | **Done** |
| Booking link | Dashboard and onboarding showed the placeholder host `tori.example` as the owner's link; e-mail links fell back to localhost on Vercel | critical | real host, clickable, copy button; `appUrl()` falls back to the deployment host | LAUNCH W3, defect list | `booking-link.spec.ts` (every business kind), unit test | **Done** |
| Legal | Operator identity, counsel sign-off, production region unknown | blocker for launch | owner decisions A6/A1 | LEGAL gate rows 1, 11 | - | **Open (owner)** |
| Legal / sensitive data | Optional sensitive intake fields (allergies, "rehabilitation" goal, visit reason) for health-adjacent kinds | blocker until decided | counsel decides whether to keep, under what notice; engineering can remove or generalise the fields quickly | LEGAL items 5, 54 | counsel decision recorded | **Open (counsel)** |

## P1 - important
| Area | Problem | Severity | Fix | Source | Verification | State |
|---|---|---|---|---|---|---|
| Privacy | A real visitor's browser stored a `lab-session` entry on the booking page (design-lab leftover) | medium | only the design lab creates it | LEGAL 14, 20 | new `consent-cookies.spec.ts` (cookies, storage, origins) on mobile and desktop | **Done** |
| UX | Unknown address while signed out redirected to the login page | medium | branded 404 with exits; protected paths unchanged | UX README (404) | `not-found.spec.ts` | **Done** |
| UX | Dashboard free time read `25:00` | medium | "25 ש׳ / 45 דק׳" | UX playbook (plain words) | unit test, `lab-dashboard` 66/66 | **Done** |
| UX | Two empty panels pushed today's schedule down on mobile | medium | panels first only when something needs a decision | UX patterns (dashboard hierarchy) | before/after screenshots in `docs/evidence/ux/` | **Done** |
| Web | no sitemap, no canonical, no Open Graph | medium | added | LAUNCH W10, W11, W16 | `seo.spec.ts` | **Done** (preview image open, see P2) |
| Retention | Appointments and customers of an active business have no age limit | medium | counsel/owner sets a period; then a maintenance step | LEGAL 31 | pgTAP on the new rule | **Open (decision)** |
| Security | No incident-response runbook with roles and a notification decision record | medium | draft written (`docs/runbooks/incident.md`); owner names the roles; rehearse once in staging | LEGAL 39, LAUNCH OPS | rehearsal log | **Draft done, roles Open** |
| Security | Supabase Auth leaked-password protection disabled (advisor WARN) | medium | enable in the Supabase dashboard (provider paid tier) | LEGAL 37 | advisor clean | **Open (owner)** |
| Operations | Point-in-time restore not drilled (a logical rehearsal exists), no alert test, cron daily on the test plan | high before launch | PITR drill on the production project per `docs/runbooks/restore.md`; synthetic failure to the alert destination; paid-plan cron (A3) | LAUNCH 38, 39, gate 9 | drill log | **Open (owner/ops)** |
| Vendors | No DPAs; production region unknown | high before launch | counsel + owner; fill `processors-and-transfers.md` | LEGAL 41 | signed documents | **Open (owner)** |

## P2 - product quality
| Area | Problem | Fix | Source | State |
|---|---|---|---|---|
| UX | Header shows the raw e-mail (long on desktop) | account menu with initial, e-mail inside | UX navigation | Open |
| UX | Native date inputs follow the browser locale (`10/15/2026`) | localized day picker in the owner agenda | UX forms | Open |
| UX | Greeting and day title repeat on the dashboard | one title line | UX hierarchy | Open |
| UX | Booking page on desktop is one narrow column | summary side panel (service, person, time) | EXAMPLE-BOOKING-EXPERIENCE | Open |
| Motion | Reduced motion was untested | test with a negative control | MOTION | **Done** (`reduced-motion.spec.ts`) |
| Web | No social preview image, no structured data | needs a real brand asset; add only visible facts | LAUNCH W13, W16 | Open (design) |
| Web | Core Web Vitals not measured | Lighthouse lab run on the Preview; field data after launch | LAUNCH W17 | Open |
| Privacy | `notification_log` has no age-based purge | add to `maintenance_run` | LEGAL 31 | Open |
| Privacy | No request register for rights requests | simple register once a real contact exists | LEGAL 28 | Open |
| Accessibility | no manual screen-reader pass, no external audit | manual pass (VoiceOver/NVDA) then external audit | LEGAL 51 | Open |
| Licences | no SBOM/licence scan | add a licence check to CI | LEGAL 43 | Open |

## P3 - polish
Preview images per business kind (needs brand assets), extra microinteractions only where they carry meaning, English locale (not planned), PWA manifest (only if an installed experience is wanted; stores would add their own rules).

## Not applicable now (documented, not skipped)
App stores (Play, App Store), marketing e-mail and unsubscribe (no marketing), cookie banner choices (no optional category), payment provider terms and subscription disclosures (no real charging).
