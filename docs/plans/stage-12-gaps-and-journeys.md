# Stage 12 — close the P0 product gaps, then full user-journey simulations

Why: after stage 11 the launch checklist (A7) lists three P0 scenarios the code does not implement, and the owner asked for the next development step followed by complete end-to-end user simulations.

## Part A — scenarios implemented
| ID | Decision (no product input was available, so these are the simplest policies that satisfy the catalog; each is one setting/function to change) |
|---|---|
| RSC-01/02 | A customer can move an appointment from their private link to another free slot **of the same service** (RSC-03 stays out: no service/duration change). Allowed only while cancelling would be allowed (`cancel_until_hours`); outside that window the page says so. The same row moves in one transaction (id, reference and link stay valid; ICS UID stays, SEQUENCE rises); if the new slot is taken the old one stays (the EXCLUDE constraint refuses the update). At most 3 moves per appointment. Services that need approval go back to `pending`. The old slot is offered to the waitlist. Customer and owner get one e-mail each. |
| BKG-08 | Per-business policy `no_show_policy` = `off` (default) / `warn` / `require_approval` / `block`, with `no_show_threshold` (default 3) counted over the existing 60-day window. `require_approval`: new bookings by that phone are `pending`. `block`: refused with the business' polite text (`BLOCKED`), no detail about the count. `warn`: the owner sees a flag on the booking/customer. Owner can clear it per customer (`blocked_override`) and every change is audited. |
| ACC-09 | Owner data export (JSON, owner only, audited) and account deletion with a 14-day grace: request ⇒ the business stops accepting bookings, future appointments are cancelled and customers notified, owner can cancel the request; after the grace a purge job anonymises customers and deletes the business. |

## Part B — user-journey simulations (the end-to-end proof)
One serial Playwright project, `journeys`, with real browsers, the real database, the fake mail provider and the cron endpoints driven through HTTP. Each journey crosses several modules, which is what shows the pieces work together:
1. **Owner onboarding → first booking:** sign up, create business, catalogue, hours, publish → customer books from a phone-sized browser → owner sees it, approves → both get mail → reminder job → customer adds to calendar → visit → complete → report/CSV show it.
2. **Customer self-service:** book → reschedule → cancel → slot returns to the public → waitlist offer accepted by a waiting customer.
3. **Abuse & policy:** no-show history ⇒ approval/block; double booking race; stranger replays a phone.
4. **Business lifecycle:** trial → grace → degraded → manual reactivation (billing) with banner; staff vs admin vs owner permissions; MFA.
5. **Compliance & operations:** legal acceptance, consent, data export, account deletion grace and purge, health endpoints.
Each journey asserts on the database and on the sent mail, not only on the page.

## Evidence
pgTAP for every new function (incl. negative controls), unit tests for plan/templates, E2E per feature, then the journeys file, `docs/evidence/stage-12.md`, CI per job.
