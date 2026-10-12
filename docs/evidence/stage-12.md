# Evidence — Stage 12: the three P0 product gaps, then full user-journey simulations

Plan: `docs/plans/stage-12-gaps-and-journeys.md`. Evidence is for the commit that contains this file. The policy choices below were mine (no product input was available); each is one setting or function to change, and the launch checklist (A7) asks the owner to confirm them.

## Part A — scenarios implemented
| Scenario | What exists | Tests (negative controls marked ◆) |
|---|---|---|
| RSC-01/02 customer reschedule | one transaction on the same row (id, reference and link stay valid), same cancellation window, max 3 moves, approval-required services go back to pending, the old slot goes to the waitlist, one mail each to customer and owner, ICS SEQUENCE rises | pgTAP 120 (atomic refusal on a taken slot ◆ limit check broken ⇒ fails), E2E `reschedule` (UI picker, mails, ICS, race on the new slot, window, limit, forged tokens), unit (plan/templates/stale) |
| BKG-08 no-show policy | `off/warn/require_approval/block`, threshold over a rolling 60 days, polite business-written text, nothing about counts, owner override per customer (audited), settings page `/settings/booking` (also the first UI for the existing booking rules) | pgTAP 130, E2E `no-show-policy` (old no-shows do not count; other customers unaffected), permission matrix |
| ACC-09 export + deletion | owner-only JSON export (audited), deletion = type the name, booking page closes, future appointments cancelled with the normal customer mail, 14-day grace with a banner and a way back, nightly job purges, audit rows kept | pgTAP 140 (staff refused, wrong name refused, no re-publish while pending, purge only after the grace period, cascade), E2E `account`, permission matrix |

## Part B — user-journey simulations (`npm run test:journeys`, project `journeys`)
Each journey brings its own browsers (an owner at a desk, customers on 360-px phones), uses real pages, real mail (outbox + Mailpit for sign-up), the real jobs over HTTP and reads the database only to check results.
| # | Journey | Modules that had to work together |
|---|---|---|
| 1 | owner signs up → onboards → publishes → customer books on a phone → owner sees it → confirmation mail → reminder job (once) → private link, calendar file, reschedule → visit completed → customers page, report and CSV agree | auth mail · onboarding · publish · public booking · agenda · outbox · reminders · ICS · reschedule · reports · exports |
| 2 | A books · B joins the waitlist · A cancels · B offered by mail and accepts · C refused · A's old link dead · owner sees B | booking · waitlist · cancel link · transactional offer · single-use links · notifications |
| 3 | no-shows ⇒ approval ⇒ approve ⇒ block with the owner's text ⇒ forgive; impostor with a known phone; 10-way stampede for one slot; staff cannot export, delete, or change rules | settings · policy · approvals · mail · RLS roles · concurrency |
| 4 | trial ends ⇒ page closes, data intact, exports 402 ⇒ pay in checkout ⇒ everything reopens ⇒ failed card ⇒ grace | billing state · public page · private links · owner data · fake provider + webhook |
| 5 | untracked visitor · terms gate · customer erased (refused with a future appointment) · full account export · business closed (customers mailed) · purge · monitoring endpoints | legal pages/cookies · gate · erasure · export · deletion job · health |
| 6 | new service · archive · closed day · walk-in · approval rule · reject · owner cancel | catalogue · hours · public page · manual booking · approvals · mail |
| 7 | all six kinds of business: a customer books with that kind's own questions, the owner sees the answers | business-kind configuration end to end |

### What the simulations found (and what was done)
- **A real bug, journey 2:** the waitlist offer e-mail says the slot is kept for the person offered it, but nothing kept it — the public page could sell the slot meanwhile. A live offer now reserves its slot (public busy list, public booking, reschedule); the owner can still book it by hand (WLT-04). Two older tests encoded the old behaviour (they "proved" that a public booking beats an offer) and were rewritten to the new contract, with the old situation reproduced through the owner's manual booking.
- Test infrastructure, not the app: shared fixture addresses hit the new per-address mail limit (tests now get their own budgets unless they ask for a shared one); a keep-alive reset (`ECONNRESET`) in the slot helper is retried; one "networkidle" wait on a polling dashboard was replaced by a bounded wait and a longer timeout.
- Database tests assume a fresh database (E2E leaves businesses behind: two tests matched leftover rows); CI always starts fresh, locally run `supabase db reset` first.

## Results
| Layer | Result |
|---|---|
| Lint / typecheck / build / bundle scan | PASS (exit 0) |
| Unit | PASS — 477 |
| DB (pgTAP) | PASS — 739 checks in 15 files; schema lint empty |
| Full Playwright (desktop + mobile-360 + journeys) | **PASS — 487 passed, 1 skipped (pre-existing), exit status 0.** An earlier full run had 2 failures, both test-infrastructure (a 'networkidle' wait on a polling dashboard; a keep-alive reset) — hardened and the whole suite re-run clean |

## Known limitations (not claimed)
- RSC-03/04 (change service or duration, owner moves a booking), NSH-01/02/06 (attendance confirmation), NTF-09/10/11, ACC-10, CAT-05/06/07 are still not built.
- Deleting the account removes the business and everything under it, **not** the owner's sign-in identity (a deleted owner could create a new business); removing identities needs a decision about shared users.
- Reschedule is for the customer only; the waitlist join does not apply the no-show policy.
- The simulations run on one machine with a fake mail provider and the fake billing provider: they prove the modules fit together, not that Resend, a payment provider or Supabase production behave the same.
