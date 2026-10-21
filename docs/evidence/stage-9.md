# Evidence — Stage 9: SaaS subscriptions + entitlements, with a plug-in payment provider

Plan: `docs/plans/stage-9-billing.md` · decision D22. Evidence is for the commit that contains this file. **No real payment provider is connected** (not chosen yet): everything below ran against the `fake` provider (signed webhooks, hosted-page simulation) and the database. A real provider is one more adapter; it has not been tested here.

| Layer | Result |
|---|---|
| Lint / typecheck / build / bundle secret scan / Gitleaks (local) | PASS (exit 0 each) |
| Unit (vitest) | PASS — 435 (adds 11: fake-provider signature, tamper, replay window both ways, timestamp covered by the signature, malformed payloads, boundary schema, manual adapter accepts no webhooks). Negative control: replay window widened ⇒ the replay test fails |
| DB (pgTAP `080_billing`) | PASS — 600 checks total; schema lint empty. States (trial / active / grace / degraded / cancelled-but-paid), `can()` / `limit()`, expired/unlimited overrides, event semantics (applied / duplicate / stale / unknown business / invalid plan / invalid type), grace clock not extended by a second failure, enforcement triggers (appointments, waitlist, services quota incl. reactivation), downgrade deletes nothing, platform-admin + MFA (aal2) gate, audit rows, RLS and privileges (owners cannot edit subscriptions, read events or provider ids, or send events). Negative control: appointment trigger dropped + state forced active ⇒ 8+ checks fail |
| E2E `billing.spec.ts` (desktop + mobile-360) | PASS — 20 runs. Webhook: bad signature / stale timestamp / no header / malformed / wrong provider / bad uuid / unknown type ⇒ 400/404 and **nothing changes**; applied once, duplicate recognised, older event ignored, arrival order irrelevant, other tenant untouched · expired trial ⇒ public page says closed, availability and booking answer 409 `BOOKINGS_CLOSED`, owner add ⇒ 402, **existing appointment still manageable, nothing deleted**, webhook payment reopens everything · grace keeps customers booking, then degrades, payment recovers · cancel keeps the paid period · starter plan: 402 on waitlist setting and exports, public waitlist closed (404), UI upsell, earlier entry kept, override restores a feature · service quota at limit refused, downgrade deletes nothing, freeing room allows adding · **checkout through the UI: returning without paying changes nothing; paying with a 3 s delayed webhook shows "processing" and the page updates by itself**; failed payment ⇒ grace banner; portal cancel · staff cannot start checkout (403), CSRF, validation, owner cannot touch provider tables or call the event RPC, non-admin cannot override |
| Visual | billing page, dashboard banners (trial ending / degraded), over-quota at 360 and 1280, reviewed by eye; axe WCAG 2.2 AA clean; no overflow |
| Full Playwright suite | PASS — 407 passed, 1 skipped (pre-existing), exit status 0 |

## Design points worth knowing
- State comes **only** from `private.billing_apply_event` (system key, service-role-only RPC) or a platform admin. Checkout/redirect endpoints never write.
- Enforcement is in the database (triggers), not only the UI, so no code path can bypass it: manual owner bookings, public bookings, waitlist-accepted bookings all pass the same guard.
- Public catalogue never exposes the owner's phone (an existing test guards this); the closed page shows name + address only.

## Found and fixed while verifying
- My first catalogue change exposed the business phone; existing pgTAP 030 correctly refused → removed.
- `public.my_billing` was executable by anon (schema lint) → revoked.
- pgTAP: `now()` is constant inside a transaction, so "future" events made the manual admin event look stale → manual events are ordered after the latest event by definition.
- Test fixtures: strict customer schema on manual booking, duplicate references from earlier runs.
- `Date.now()` in a render path (lint rule) → moved to a helper.

## Known limitations (not claimed)
- **No real provider**: checkout/portal URLs, webhook formats, proration, tax invoices (BIL-10) and provider-side dunning belong to the adapter that will be chosen. The `manual` adapter works through admin RPC/API only (no UI).
- **No e-mail for trial ending (T-7/T-1) or payment failure** — in-app banners only. The e-mail pipeline can carry them (owner recipient exists); not built yet.
- Back-office has RPC + API (platform admin + MFA) but **no UI**; admins are added by SQL.
- Plan prices are placeholders in the `plans` table (editable data), not a pricing decision. Trial length (14 days) and grace (7 days) are constants in the migration.
- BIL-07 (grandfathering) stores `plan_version` only; price-change workflow is not built.
- Existing businesses created before this migration received a fresh 14-day trial.
- CI result (checked on GitHub): 094580f: CI, Security and CodeQL all green.
