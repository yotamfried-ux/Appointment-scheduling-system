# Evidence — Stage 8: customers, statistics, reports, exports

Plan: `docs/plans/stage-8-customers-reports.md`. Evidence is for the commit that contains this file. Numbers in tests are worked out from raw rows by an oracle that does not call application code (see below).

| Layer | Result |
|---|---|
| Lint / typecheck / build / bundle secret scan / Gitleaks (local) | PASS (exit 0 each) |
| Unit (vitest) | PASS — 424 (adds 30 metric/CSV tests: definitions, zero-filled days, per-service sums, formula neutralisation; reducer now allows completed ⇄ no-show) |
| DB (pgTAP `070_reports`, `040` updated) | PASS — 522 checks total; schema lint empty. Hand-checked dataset across the Israel DST change (2026-03-27) with rows at 23:30 / 00:30 / 23:59 / 00:00 boundaries; search (incl. LIKE wildcards, local→international phone), sort whitelist, paging, rolling 60-day no-show count, anonymization keeps report numbers, audit rows, RLS/privileges |
| E2E `reports.spec.ts` (desktop + mobile-360) | PASS — 20 runs. API **and** page equal an independent oracle (appointments, revenue, expected, no-show %, cancel %, average, new/returning customers, per-day buckets across DST); empty period, invalid range (422), >400 days (422); 401 on every new endpoint; customer search/sort/paging/injection; NSH-04 correction and NSH-05 flag; notes (500 limit, CSRF 403); two-step erase blocked by a future appointment, then done, numbers unchanged, audit row; tenant isolation (404); staff cannot export or erase (403); rate limit 429 + Retry-After; **25,000-row export**: BOM, header, one row per appointment (unique), price sum equals the database, chronological, formula cells neutralised, audited with row count; customer export count equals database |
| Visual | Reports and customers at 360 and 1280, screenshots reviewed by eye; axe WCAG 2.2 AA clean; no horizontal overflow |
| Full Playwright suite | PASS — 387 passed, 1 skipped (pre-existing), exit status 0 |

## Found and fixed while verifying
- By-service table scrolled horizontally at 360 (axe: scrollable region not keyboard accessible) → card list on mobile, table from `sm`.
- Mobile period form: the "show" button sat alone beside the second date; date text touched the picker icon → two-column dates, full-width button, tighter padding.
- Customer list had no column headers on desktop and an unstyled sort select → header row (labels stay for screen readers), shared select component.
- Export route counted malformed requests against the rate limit → validation now runs first.
- Test bugs: global unique references, shared client IP bucket, a name lacking the underscore it was meant to test, and an assertion that ignored the repeated hour when clocks go back.

## Known limitations (not claimed)
- Exported local times are ambiguous for the one repeated hour per year when clocks go back (both occurrences are exported, in time order).
- Phone cells starting with `+` get a leading apostrophe (spreadsheet-injection protection), visible in Excel.
- Reports read live tables; no materialized views or caching (fine at this scale, revisit at ~10⁶ appointments per business).
- Export download is a streamed response; if the client disconnects mid-way the audit row (written before streaming, with the expected row count) still says the full count.
- Charts are dependency-free SVG bar charts; no tooltips on touch.
- CI not yet run on this commit.
