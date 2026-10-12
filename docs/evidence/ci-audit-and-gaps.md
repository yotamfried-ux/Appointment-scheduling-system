# CI audit and open-gap register (stages 0–10)

Checked on GitHub on 2026-10-12 against the PR branch `claude/optimistic-hypatia-wh3zo3` (PR #1, still a **draft**, base `main`). Source: the workflow runs and check runs of every commit on the branch. Local runs are not counted here.

## 1. CI result per stage

"Superseded" means the run was cancelled or failed and the next commit fixed or replaced it; the stage's code is judged by the first green commit that contains it.

| Stage | Commit | CI (lint/types/unit/build · DB pgTAP · E2E) | Security (Gitleaks · OSV · Trivy · CodeQL) | Note |
|---|---|---|---|---|
| 0 | `e9753bf` → `0e0ab67` | cancelled | **failed** | the scanners could not install; fixed in `52238d6` |
| 0 (fixed) | `52238d6` | green | green | |
| 1 | `e95edf3`, `fa0555e`, `625099e` | green | green | |
| 2 | `838ffeb`, `78443f0` | green | green | |
| 3 | `846761c` | green | green | |
| 4 | `291fa34` → `9d6e165` | cancelled → **green** | cancelled → green | `9d6e165` rewords one evidence line and allow-lists a Gitleaks false positive |
| 5 | `a5295e1` → `d06d93e` | **failed** → green | green | a stale test I had reported as passing; corrected in the evidence |
| 6 | `7a14f42` → `cd38466` | cancelled → green | cancelled → green | `cd38466` fixes a Gitleaks false positive in a test placeholder |
| 7 | `60742bf` | green | green | |
| 8 | `9ce366b` | green | green | |
| 9 | `094580f` | green | green | |
| 10 | `1f26bca` → `c8c99ca` | cancelled → green | CodeQL **failed** → green | a real bug (semicolons not escaped in ICS text); fixed and covered by a test with a negative control |

**Current head `c8c99ca`: all 9 check runs succeeded** (Lint·Types·Unit·Build, DB pgTAP + schema lint, E2E on desktop and mobile with axe, Gitleaks, OSV, Trivy, CodeQL ×2). The only non-success is the `review` job, which is **skipped by design** (see gap G2). The two CodeQL review threads from stage 10 are resolved.

## 2. Gaps found by this audit

| # | Gap | Evidence | What is needed |
|---|---|---|---|
| G1 | **8 open Dependabot PRs (#2–#9) were never triaged.** They were checked once against old bases, so their results are stale; two are real signals: **#6 TypeScript 5→7: Lint/Types failed**, **#5 Playwright 1.56→1.64: E2E failed**. Others are majors (eslint 9→10, lucide-react 0.511→1.53, @types/node 22→26, actions/checkout 5→7, setup-node 5→7, upload-artifact 5→7). All target the feature branch, not `main`. | check runs of PRs #2–#9 | a decision: rebase each on the current head and merge the green ones, close the rest until after launch. Not done without your say |
| G2 | **The AI PR review never ran.** The workflow is inert until a secret `CLAUDE_CODE_OAUTH_TOKEN` and the variable `CLAUDE_REVIEW_ENABLED=true` exist, and it skips draft PRs. | `review` = skipped on every run | owner action; until then the deterministic gates are the only gates |
| G3 | The PR is a **draft** against `main`, which holds only the planning docs (D19). Nothing from stages 0–10 is on `main`. | PR #1 | owner decision to mark ready and merge, or to keep working on the branch |
| G4 | **"CI not yet run on this commit" in seven evidence files** was never updated after the runs. | `docs/evidence/stage-4…10.md` | fixed in this change: each now states the real result |
| G5 | The permanent "1 skipped" E2E is intentional: `lab-booking-api.spec.ts:304` skips itself when no business kind has a required intake field. | test source | none (documented) |

## 3. Scenario coverage against `docs/04-scenarios-catalog.md`

Method and its limits: I listed every scenario ID (144) and searched the tests, plans and code for the ID. That finds only tests that **cite** the ID, so it under-counts (several tests use a short label such as "CXL:"). The numbers: **P0 63 scenarios, 23 not cited by any test · P1 58, 27 not cited · P2 22, 18 not cited.** I then read the P0 list by hand. This is a classification from reading, not a re-run.

### P0 not cited by ID — classified

| Verdict | Scenarios | Where |
|---|---|---|
| **Covered, tested under another label** | CXL-01 (cancel inside the allowed window), CXL-02 (after the window is refused), CXL-05 (double cancel), CXL-06 (old/expired/other token), NSH-03 (owner marks no-show), AVL-03 (DST), AVL-05 (closed day / exception), AVL-08 (lead time, horizon), SEC-04 (secret key in the client bundle) | `030_booking.test.sql` ("CXL:" lines), `public-booking-ui.spec.ts` (manage-page tests), `availability-slots.test.ts`, `public-booking.spec.ts:150`, `catalog.spec.ts:161`, `scripts/check-bundle.sh` + CI |
| **Implemented but NOT tested as stated** | CAT-03 (disable a service that has future appointments), CAT-04 (changing price/duration of a service leaves booked appointments as they were), AVL-07 (shortening hours while future appointments exist), CXL-04 (the exact boundary 24:00:00 vs 23:59:59), BKG-13/14 (scraping, PII in logs: only partly tested), UX-08 (keyboard + screen reader on calendar and slot picker: axe and some keyboard checks only) | the behaviour exists (service snapshot, immutable appointments) but no test asserts it |
| **NOT IMPLEMENTED (needs a product decision)** | **RSC-01, RSC-02** reschedule (customer and owner; the stage-5 evidence says so), **ACC-09** account deletion / export of the owner's data, **BKG-08** blocking customers after no-shows (only the 60-day counter exists, NSH-05) | no code |
| **Needs the owner's environment** | OPS-02 (DB pooler settings), OPS-07 (backup/restore drill: **stage 11**), OPS-04 (branch database before merge: CI runs migrations on a fresh DB only) | Supabase project not created |

### P1/P2 worth naming
- **Not implemented, by decision:** CAL-01…04, CAL-06 (D23); NTF-07 (WhatsApp/SMS, D1); BIL-10 (invoices/VAT, waits for the billing provider).
- **Not implemented, not yet decided:** NSH-01/02/06 (attendance confirmation link, reminder to owner, auto-complete), RSC-03/04, NTF-09/10/11, ACC-10, CAT-05/06/07, BKG-18, CXL-08.
- **Not tested:** UX-03 (slow/offline mid-booking), UX-04/05/06/07/10/11, AVL-04/11/12, OPS-01/03/09/10 (stage 11 covers OPS-03 readiness and OPS-09 logging notes).

## 4. What this means

Nothing that was reported as passing is failing now. The honest list of what is **not** done is sections 2 and 3: the reschedule flow (RSC), account deletion/export (ACC-09), customer blocking (BKG-08) and the untriaged dependency PRs are the ones that matter for a launch decision.
