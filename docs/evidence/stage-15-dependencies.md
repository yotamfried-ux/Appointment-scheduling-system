# Evidence — Stage 15: the eight open Dependabot PRs (audit gap G1)

Evidence is for the commit that contains this file. The PRs (#2–#9) targeted this branch and were never triaged. Each upgrade was applied alone and measured with real exit codes (typecheck, lint, unit, build), then the accepted ones together with the full Playwright suite.

| PR | Change | Decision | Why |
|---|---|---|---|
| #2 | actions/upload-artifact 5 → 7.0.2 | **accepted** | CI will resolve the pinned SHA (taken from Dependabot's diff; I cannot read those action repositories from this session, so a wrong SHA would fail CI immediately rather than silently) |
| #3 | actions/checkout 5 → 7.0.1 | **accepted** | same |
| #4 | actions/setup-node 5 → 7.1.0 | **accepted** | same |
| #5 | @playwright/test 1.56 → 1.64 | **accepted, with a fix Dependabot could not make** | its CI failed because `package.json` pins `playwright-core` to 1.56.1 in `overrides`; the override is moved to 1.64.0 |
| #7 | eslint 9 → 10 | **accepted** | typecheck/lint/unit/build all exit 0 |
| #8 | lucide-react 0.511 → 1.53 | **accepted** | all exit 0; icons render in the full suite (axe, visual) |
| #6 | typescript 5 → 7 | **rejected for now** | lint exits 2: "typescript-eslint does not support TS 7.0". Dependabot is told to skip major TypeScript until it does |
| #9 | @types/node 22 → 26 | **rejected** | runtime is Node 22 (CI and Vercel): types for a newer Node describe APIs that do not exist there. Major bumps are ignored; keep it aligned with the runtime |

## Results (all accepted changes together)
| Layer | Result |
|---|---|
| typecheck / lint / unit (480) / build | PASS (exit 0) |
| Full Playwright (desktop + mobile-360 + journeys) | PASS — 505 passed, 1 skipped (pre-existing), exit 0 |
| CI | see GitHub for the commit that contains this file |

Local note: Playwright 1.64 wants a newer Chromium than the one preinstalled on this machine and could not download it, so the local run used the existing Chromium through the new optional `E2E_CHROMIUM_PATH` setting (CI installs the matching browser itself). That is a difference between this run and CI that I could not remove.
