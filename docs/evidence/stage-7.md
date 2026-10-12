# Evidence — Stage 7: waitlist + live dashboard

Plan: `docs/plans/stage-7-waitlist.md`. Evidence is for the commit that contains this file. E-mail goes through the fake provider (see stage 6 limits): offers were verified as rows/previews, not through a real mailbox.

| Layer | Result |
|---|---|
| Lint / typecheck | PASS |
| Unit (vitest) | PASS — 393 (adds: waitlist contracts, token scope isolation incl. expiry, offer templates/privacy, check-before-send for offers) |
| DB (pgTAP `060_waitlist`) | PASS — 434 checks total; schema lint empty. Passes on a fresh database and on one polluted by earlier E2E runs. Covers privileges, join rules, FIFO offer on cancel/reject/owner-cancel, window/fit/other-day matching, accept/slot-taken/double-accept, expiry + pass-on + idempotent sweep, decline/leave, auto-offer off + manual offer, minimum notice, lost offers, past days, booked-elsewhere, guards, RLS |
| Customer E2E (`waitlist.spec.ts`, real stack) | PASS — validation per field, e-mail required, cap of 3, idempotent replay, rate limit, disabled waitlist = 404 · cancellation offers only the first in line; e-mail carries the link; accept in the browser books and the normal confirmation follows · expiry passes the slot on, the first is told, repeated sweeps change nothing · decline/leave in two steps · WLT-04 (slot taken before accept → told, stays on list) · WLT-02 (accept racing a public booking: exactly one winner; double click books once) · WLT-06 · window/fit · forged/tampered/wrong-scope tokens give one generic page, GET changes nothing, no-store/no-referrer/noindex, cron endpoint needs the secret. Stable over 4 consecutive parallel runs. |
| Owner E2E (`owner-waitlist.spec.ts`) | PASS — entries appear **without reload** (polling), auto-offer switch persists, offer dialog validation, manual offer for the freed slot, conflicts explained, two-step removal withdraws the offer, enabled switch closes the public form, API: change version, CSRF (no/foreign Origin ⇒ 403), validation, tenant isolation (404, own setting only), 401 without session. Stable over 3 runs. |
| Visual (`waitlist-visual.spec.ts`) | PASS at 360 and 1280 for: booking-day hint, join form (empty/errors/done), status page (waiting/offer/booked/removed/invalid/leave-confirm), owner panel with long names + live offer, offer dialog. No overflow, no clipped text, axe WCAG 2.2 AA. Screenshots reviewed by eye. |
| Full Playwright suite | PASS — 367, exit status 0, no failures listed |
| Build / bundle secret scan / Gitleaks (local) | PASS |

## Negative controls (each fails for the right reason, then restored)
- Offers ordered newest-first ⇒ the FIFO tests fail.
- "Already offered this slot to this person" filter removed ⇒ the unique constraint on `(entry, slot)` still blocks it (second layer, loud error).

## Found and fixed while verifying
- **I replaced** an existing `owner.waitlist` message group (used by the design-lab dashboard) instead of merging; the full run caught it (lab dashboard tests failed). Merged.
- Browser date inputs with a one-year `min`/`max` render the year greyed-out (single valid value) — confusing; removed the attributes, the server validates the range with a clear message.
- Join-form legend crowded the first label → spacing.
- Test cleanup order in pgTAP (offers reference appointments) and phone lookups across businesses on a polluted database.

## Known limitations (not claimed)
- Live updates are **polling** (10 s, tab visible), not Supabase Realtime — decision D20 (Realtime would expose the JWT to browser JS, against the httpOnly-cookie decision). Reconsider with a narrow short-lived token if sub-second updates matter.
- Offers are sequential (one live offer per time range), not parallel to several people; an entry is for one day.
- An owner may offer any free time, including outside opening hours (consistent with manual appointments).
- Cron: the sweep runs every 5 minutes (`vercel.json`); plan limits unchecked. An expired offer is also rejected at accept time, so a late sweep never lets someone take a stale offer.
- Offer e-mails use the fake provider here; real delivery needs the stage-6 prerequisites.
- Join confirmation e-mail is not sent (the customer sees the status link on screen).
- CI result (checked on GitHub): 60742bf: CI, Security and CodeQL green.
