# Evidence — Stage 6: notifications (e-mail only) + jobs

Plan: `docs/plans/stage-6-notifications.md`. Evidence is for the commit that contains this file. Provider: the **fake** adapter in dev/CI — nothing was sent through Resend (no key, no verified domain); the Resend adapter is verified against its documented request/response contract with a mocked `fetch`.

| Layer | Result |
|---|---|
| Lint / typecheck | PASS |
| Unit (vitest) | PASS — 384 (adds: planner, check-before-send rules, templates/privacy/escaping, Svix verification cross-checked against the real `svix` library, Resend status mapping + idempotency header, fake-adapter failure injection, provider/pepper/cron fail-closed) |
| DB (pgTAP `050_notifications`) | PASS — 347 checks total; schema lint empty. Covers exactly-once, claim/lease/backoff, privileges (anon/authenticated denied), reminder window + NTF-02/03/06 rules, suppression, job idempotency, RLS column grants. Also passes on a database polluted by earlier E2E runs. |
| E2E (`notifications.spec.ts`, real stack, fake provider) | PASS — job endpoints reject missing/wrong secrets · confirmation with booking facts and a private link in the body only · clinic request: customer + owner messages, no treatment name anywhere, owner gets no customer token · decided-before-send is skipped, only the decision is sent · **8 concurrent runners ⇒ one row and exactly one claim per message** · provider 5xx forever ⇒ backoff, 7 attempts, dead, booking unaffected, owner banner · fail-once ⇒ one e-mail after the retry; refused ⇒ dead at once · crashed runner ⇒ lease expires, message retried · bounce/complaint webhook ⇒ suppression; transient bounce ignored; forged/tampered/stale/unsigned webhooks refused with one answer · reminders: one per appointment, duplicate bucket skipped, cancelled-after-queued skipped, cancelled-before never queued, no e-mail = recorded skip · customer cancel informs both sides |
| Visual | PASS at 360 and 1280 for the undelivered banner (overflow, clipped text, axe); screenshots reviewed by eye |
| Full Playwright suite | PASS — 333, exit status 0, no failures listed |
| Build / bundle secret scan | PASS |

## Negative controls (each fails for the right reason, then restored)
- Unique `(appointment_id, type)` dropped ⇒ the reminder/enqueue statements fail loudly (the design depends on it).
- Claim without lease/`SKIP LOCKED` ⇒ the 8-runner test fails (attempts/sends duplicated).
- Reminder status filter removed ⇒ pgTAP reminder tests fail.

## Found and fixed while verifying
- Stage-5 evidence overstated a green run (see correction in `stage-5.md`); CI caught the stale test.
- Test-design races between my own parallel specs (global runner, global reminder windows) were root-caused and removed (distinct calendar days per reminder test; deterministic `+failonce` instead of timing tricks).

## Known limitations (not claimed)
- **No real e-mail has been sent.** Needs: Resend account, verified sending domain with SPF/DKIM/DMARC, `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET`, `NOTIFICATIONS_PEPPER`, `CRON_SECRET` set per environment (see `.env.example`), and the webhook pointed at `/api/webhooks/resend`.
- **Cron:** `vercel.json` schedules `*/5` and `*/15`; whether the Vercel plan allows that frequency is unchecked (OPS-06). The post-booking "kick" covers the common case; an external scheduler or pg_cron is the fallback. No alert yet when a heartbeat is missing.
- Templates are plain functions with explicit escaping, not React Email; not yet checked in real mail clients (NTF-08 partially covered).
- Not built: re-engagement and owner summaries (NTF-09/10/11), unsubscribe links (all messages are service messages), e-mail field in the manual-appointment form, expiry of unanswered requests, dead-letter retry from the UI.
- Declining a cancellation request re-uses the earlier confirmation (no new e-mail).
- Owner e-mail goes to the business owner role only.
- CI not yet run on this commit.
