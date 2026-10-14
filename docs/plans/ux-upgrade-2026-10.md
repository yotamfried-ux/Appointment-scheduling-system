# UX/UI upgrade pass (2026-10-13), driven by Engineering-OS `docs/ui-ux/*`

## Sources used (Engineering-OS PR 297 branch `docs/product-experience-ui-content-atlas-20261013`)
EXPERIENCE-ROUTING (activation/workflow), SCREEN-CONTENT-PLAYBOOK (real copy, states), MOTION-AND-INTERACTIONS (reduced motion), PRODUCT-EXPERIENCE-QUALITY-GATE (scoring/evidence), EXAMPLE-BOOKING-EXPERIENCE (Hebrew booking flow), `docs/ui-ux/README.md` (empty/error states, a11y, forms), `patterns/ui/README.md` (tokens, a11y, dashboard hierarchy). SOURCE-ATLAS was used as a reading list only: no external site was visited from this environment (egress blocked), so no pattern here is "copied from" a named product and no performance/conversion number is claimed.

## Method
Captured 18 screens x 2 widths (360, 1280) of the real app against the local stack (`tests/e2e/ux-capture.spec.ts`, `UX_SHOTS=... UX_LABEL=before|after`), read each against the playbooks, listed problems, fixed those that are safe within the existing architecture.

## Already good (kept)
Landing/auth (redesigned earlier today: no prices, no invented claims), booking stepper (RTL correct), person choice, team settings, billing page, empty states of approvals/waitlist/reports (answer why/what/how), axe-clean on all public + owner pages.

## Problems found -> change
| # | Problem (screen) | Change | Evidence |
|---|---|---|---|
| 1 | Unknown address while signed out redirected to the login page (a mistyped or outdated link asked for a password) | Real branded 404 with two exits; proxy asks for a session only for owner pages + `/api` | `not-found.spec.ts` (404 status, axe, protected pages still redirect, API 401) |
| 2 | Dashboard "free hours" showed `25:00` with hint "שעות:דקות · כדאי למלא" (reads as a clock time; jargon) | "25 ש׳" / "45 דק׳" / "2 ש׳ 30 דק׳", hint "זמן שעוד אפשר למלא" | unit test `free-label`, `lab-dashboard` 66/66 |
| 3 | Mobile dashboard: two empty panels (approvals, waitlist) pushed today's schedule ~1200px down | Panels go first only when something needs a decision; otherwise after the schedule | before/after screenshots |
| 4 | Reports range shown as ISO `2026-09-14 – 2026-10-13` | "14 בספטמבר 2026 – 13 באוקטובר 2026" | `reports.spec` |
| 5 | Customers: last visit "עוד לא" (cut sentence) | "עדיין לא" | copy |

## Quality gate (honest status)
- Keyboard/a11y (axe WCAG 2.2 AA) on changed pages: PASS (not-found, reports, dashboards in specs).
- Mobile 360 / desktop 1280, no horizontal overflow: PASS on 154 specs run (mobile+desktop) for the touched areas.
- Reduced motion: PARTIAL — global `prefers-reduced-motion` block exists in globals.css and the ribbon uses `motion-safe`; not re-tested in a browser this pass.
- Real-user comprehension / conversion: NOT TESTED (no users, no analytics); nothing here is claimed to raise conversion.
- Cloud (Vercel) look: NOT TESTED this pass (Deployment Protection blocks external capture).

## Remaining gaps / recommendations (not done)
1. Header shows the raw account e-mail (long on desktop, hidden on mobile): replace with an account menu (name/initial + e-mail inside).
2. Native `<input type=date>` follows the browser locale (en-US `10/15/2026` in headless): consider a localized day picker for the owner agenda.
3. Dashboard repeats greeting + day heading; merge into one title line.
4. Booking page on desktop is a single narrow column with large empty areas; a summary side panel (service, person, time) would use the space and reinforce confidence.
5. Customer list: no empty state captured with zero customers; no row-level link affordance beyond the name.
6. Run a real owner usability session with 3-5 salon/clinic owners before further redesign; measure sign-up completion with real analytics.
