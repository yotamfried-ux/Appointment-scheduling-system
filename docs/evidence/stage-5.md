# Evidence — Stage 5: owner dashboard, agenda, approvals inbox, manual appointments

Plan: `docs/plans/stage-5-owner-dashboard.md`. Evidence is for the commit that contains this file.

| Layer | Result |
|---|---|
| Lint / typecheck | PASS |
| Unit (vitest) | PASS — 339 (adds: real-date validation, owner contracts, reducer actions) |
| DB (pgTAP `040_owner_ops`) | PASS — 288 checks total; schema lint empty. Negative control: with the `too_early` rule removed 3 tests fail; restored. |
| Owner API E2E (`owner-api.spec.ts`) | PASS — 401 JSON without session, approve/reject (+ slot returns to public), double approve → 409, CSRF (no / foreign Origin → 403, nothing changes), tenant isolation (other owner sees nothing, "not yours" = 404, unknown field refused, foreign service refused), manual appointments (confirmed, out-of-hours flag computed by the server, overlap 409, field-level validation), complete / no-show only after start, owner cancel frees the slot |
| Browser "Dana" (`owner-dashboard.spec.ts`) | PASS — inbox across days, approve / reject, double click acts once, add from a free gap, conflict explained in the dialog and nothing lost, out-of-hours tag, two-step cancel, closing out a started visit as no-show, day navigation, failed load → retry, stale tab rolls back to server truth |
| Visual (`owner-visual.spec.ts`) | PASS at 360 and 1280: no overflow, no clipped text, axe WCAG 2.2 AA (agenda, dialog, empty day); dialog reachable on a 520px-tall phone. Screenshots reviewed by eye. |
| Full Playwright suite | **CORRECTION:** the commit that first contained this file reported "PASS — 293", but that run actually had one failing test (an older tenant-isolation test completed a future appointment, which the new `too_early` rule forbids). My output filter hid the failure and CI caught it; fixed in the next commit. The suite is green from `d06d93e` on. |
| Build / bundle secret scan | PASS |

## Found and fixed while verifying
- **Real bug:** a long unbreakable customer name widened the mobile page by 184px (whole layout shifted) → `min-w-0` + wrapping.
- **Real bug:** the date field's year was cut off by its icon in a two-column form → stacked on phones.
- **Real bug:** dialogs had no max-height/scroll; on a short phone the submit button could be unreachable.
- **Real bug:** `IsoDate` accepted impossible dates (`2026-13-45`) on POST bodies → real-calendar validation in the shared contract.
- **Real bug:** unauthenticated API calls were redirected to the HTML login page (200) → JSON 401.
- Desktop shell was too narrow for a calendar (names cut to 3 letters) → wide container for the dashboard.
- An old toast could cover a dialog's title → toasts are dismissed when a dialog opens.

## Known limitations (not claimed)
No notifications to owners or customers yet (stage 6) · pending requests never expire yet (stage 6 job) · no reschedule / edit of an appointment · owner transitions need the admin role (staff can create manual appointments but not approve) · one business per account in the UI · `owner_note` is not editable after creation · waitlist and reports come later · CI not yet run on this commit.
