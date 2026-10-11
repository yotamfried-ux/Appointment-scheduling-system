# Evidence — Stage 4: public booking

Plan: `docs/plans/stage-4-public-booking.md`. Evidence is for the commit that contains this file; mock-backed lab tests are not counted here.

| Layer | Result |
|---|---|
| Lint / typecheck | PASS |
| Unit (vitest) | PASS — 322 (incl. token sign/verify/rotation/tamper) |
| DB (pgTAP, `030_booking.test.sql`) | PASS — 261 checks total; `private.lint_violations()` empty |
| API E2E vs real Postgres (`public-booking.spec.ts`) | PASS — catalogue/availability vs independent computation, idempotency, validation (tenant spoofing refused), INVALID_SLOT / SERVICE_UNAVAILABLE / BOOKING_LIMIT, approval kinds, 50-way same-slot race (1 winner, 49×409), 100 mixed overlapping requests (no overlap in DB), double submit, rate limits (IP / phone, no raw IP/phone stored), anon RPC denial, tenant isolation, slug redirect |
| Browser E2E (`public-booking-ui.spec.ts`) | PASS — full journey, kind variants (clinic pending, teacher intake), two-browser race, lost-response retry reusing the idempotency header, closed and unpublished businesses give identical 404 pages, long name, 44px targets; manage link: GET changes nothing, confirmed POST cancel frees the slot, forged/tampered/garbage tokens identical generic page, replayed action no-op, foreign Origin rejected, too-late window, no-referrer + noindex + no-store |
| Visual (`public-pages-visual.spec.ts`) | PASS at 360 and 1280: no overflow, no clipped text, centered column, axe WCAG 2.2 AA at every step; screenshots reviewed by eye |
| Full Playwright suite | PASS — 269 |
| Build / bundle secret scan | PASS |

## Found and fixed while verifying
- Real done page promised an e-mail, a calendar file and rescheduling that do not exist yet → honest copy, calendar button hidden, real `cancelUntilHours` shown.
- Several of my own test mistakes (wrong kind for a location check, per-phone limit tripped by the test itself) — product behaviour was correct.

## Known limitations (not claimed)
Group services not offered publicly · Turnstile deferred · no e-mails yet (outbox events are written; Stage 6) · slot hold is a client timer only · `x-forwarded-for` trusted (Vercel overwrites it) · cloud Supabase/Vercel not connected (needs owner approval) · MFA enforced in app layer, not RLS · closed page has no onward link · CI not yet run on this commit.
