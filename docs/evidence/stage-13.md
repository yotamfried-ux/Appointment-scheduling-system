# Evidence — Stage 13: closing what stage 12 left open

Evidence is for the commit that contains this file. Scope was agreed in the conversation: close the items stage 12 listed as "still open". What can be closed in code was built; what was left out **on purpose** is recorded as decision D24 (`docs/00-decisions.md`) so it is a visible choice, not a hidden gap.

## Built
| Item | What exists | Tests |
|---|---|---|
| ACC-09 (rest) | the purge also removes the owner's and staff's sign-in identities when nothing else keeps them (another business, platform admin) | pgTAP 140 (identity gone; **control:** a platform admin member keeps theirs), journey 5 (the identity is gone and the password no longer works) |
| CAT-05 | price modes: fixed / "from X" / free / hidden, DB constraint (a free service costs 0), settings select, public page, private page | E2E `price-mode`, DB check refuses nonsense |
| NSH-01 | "I am coming" button on the private page; never changes the status; idempotent | pgTAP 150, E2E `attendance-digest` |
| NSH-02 | one owner alert N minutes before an unconfirmed visit; opt-in (default off); not for bookings made inside the window | pgTAP 150, E2E (off by default ⇒ nothing; on ⇒ exactly one; confirmed ⇒ none) |
| NSH-06 | visits the owner never closed are completed by themselves after N hours when the business chose that; never a no-show; audited | pgTAP 150, E2E |
| NTF-11 / NTF-09 | daily owner digest: opt-in, once per local day, only 07:00–21:00 local, never empty; counts only, no customer names | pgTAP 150, unit (render, escaping), E2E (04:00 and 22:00 ⇒ nothing, noon ⇒ one, nothing to report ⇒ none) |
| RSC-03 | a customer may change the service while moving, only if the business allows it (setting, default off); length, price and snapshot follow | pgTAP 160, E2E `move-and-service-change` |
| RSC-04 | the owner moves a booking from the calendar; same row and link; customer mailed; the customer may decline at any time (no window); audited | pgTAP 160 (atomic refusal, staff refused), E2E (calendar dialog, taken time refused, customer declines inside a 30-day window; **control:** an unmoved booking is still bound by the window), permission matrix |

## Results
| Layer | Result |
|---|---|
| Lint / typecheck / build / bundle scan | PASS |
| Unit | PASS |
| DB (pgTAP) | PASS — schema lint empty |
| Full Playwright (desktop + mobile-360 + journeys) | 502 passed, 1 skipped (pre-existing), 1 failed: the walk-in test, whose cause is now **found and fixed** (see below). After the fix: the test 20/20 in repeated runs; the rest of the suite was green in that same run |

## Not built, on purpose (D24)
CAT-06, CAT-07, BKG-18, CXL-08, ACC-10, NTF-10. NTF-10 (re-engagement) needs a consent category and the consent framework deliberately has none registered; CXL-08 has nothing to charge because customer payments are out of scope.

## Honest limits
- The attendance alert and digest are mails to the owner only; there is no in-app notification centre.
- RSC-04 uses a column (`moved_by_business_at`) instead of the catalog's `RESCHEDULED_BY_BUSINESS` status, to avoid touching the state machine.
- The mail, billing and payment providers in all simulations are the fake ones.

## The intermittent walk-in test: cause found
It waited for the *title* of the agenda, which is visible for today's agenda all along, so on a slow run it clicked "add" while today was still displayed and booked **today** instead of the chosen day. It now waits until the date input (which shows the agenda's own date) has the new day. The earlier note in `stage-11.md` ("cause not isolated") is superseded by this.
