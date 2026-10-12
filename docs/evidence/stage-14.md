# Evidence — Stage 14: launch polish that code can do (B4 speed, B8 subscription mail)

Evidence is for the commit that contains this file. Both items come from `docs/08-launch-checklist.md` (section B).

## B4 — the booking page is usable sooner
Cause: the page rendered "loading" and fetched the services in the browser, so the first screen waited for JavaScript **and** a request. Fix: the server already resolves the business, so it now hands the services to the client component (`initialCatalog`) and the first step is in the HTML; the old fetch remains only for retries.

Measured with Lighthouse 12 (mobile preset, simulated throttling) against a production build on this machine, three runs each, same business, same machine:
| | performance | FCP | LCP | TBT |
|---|---|---|---|---|
| before | 72 · 83 · 86 | 1.4 s | 3.8 – 4.3 s | 160 – 520 ms |
| after | 96 · 96 · 98 | 1.0 – 1.4 s | 2.0 – 2.5 s | 110 – 130 ms |

Limits: one local machine and simulated throttling, so the absolute numbers say nothing about production; the before/after on identical conditions is the evidence. Run-to-run variance is large (the "before" runs spread 72–86). Real devices and the production CDN are not measured. 50 existing booking/visual/axe tests pass unchanged.

## B8 — the owner is told by mail
| Notice | When | Once per |
|---|---|---|
| trial ending | trial ends in more than 1 and at most 7 days | trial end date |
| last day | trial ends within a day | trial end date |
| payment failed | subscription is in the grace period | grace end date |
Check-before-send: if she paid or the state changed after the notice was queued, it is skipped (`subscription_changed`), never sent. Businesses being deleted are not mailed. Implemented as business-level rows in the existing outbox (`notification_log.digest_date` is the milestone date), sent by the same job that runs the owner housekeeping.

| Tests | |
|---|---|
| pgTAP `170_billing_notices` | right state, right window, once per milestone, not for active/expired/being-deleted, system only |
| unit | stale rules, honest "days left", link to billing, no URL in the subject |
| E2E `billing-notices` | 14 days ⇒ nothing; 5 days ⇒ one mail with the day count (twice run ⇒ still one); last day ⇒ one; failed card ⇒ one; **control:** a notice queued before she paid is skipped |

## Results
| Layer | Result |
|---|---|
| Lint / typecheck / build / bundle scan | PASS |
| Unit | PASS |
| DB (pgTAP) | PASS — schema lint empty |
| Full Playwright (desktop + mobile-360 + journeys) | 504 passed, 1 skipped (pre-existing), 1 failed: a `socket hang up` on a webhook POST (the same keep-alive race seen before as `ECONNRESET`). Root cause addressed in the test server (`--keepAliveTimeout 65000`: Node closed idle connections after 5 s while the test client reuses them); the billing and permission specs pass after it. The change is test infrastructure only; it is **not** proof that the race is gone, only that its cause is removed |

## Still not done (owner or third party)
See `docs/08-launch-checklist.md` section A and B1–B3, B5–B7, B9–B10: accounts, legal text, external pentest, CAPTCHA, monitoring, human accessibility audit.

## Journey 6 flakes found by CI and fixed (test timing, not the app)
CI failed once on journey 6: it looked at the public page right after clicking "restore" (before the save landed), then, when repeated locally, booked its walk-in on today's agenda before the chosen day had loaded and added a holiday before the hours page was interactive. All three were my test's missing waits; each now waits for the page's own state (list updated, date input shows the loaded day, preview visible). Journeys 1, 3 and 6: 18/18 in repeated runs.
