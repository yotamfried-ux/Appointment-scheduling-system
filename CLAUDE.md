# CLAUDE.md — Appointment Scheduling System

Multi-tenant appointment-booking SaaS for small businesses (Hebrew/RTL first). Rebuild of "Project 8" on Next.js + Supabase + Vercel.

## Read first
`docs/00-decisions.md` → `docs/03-architecture-and-plan.md` → `docs/04-scenarios-catalog.md` → `docs/05-security-architecture.md`.

## Working rules
1. **Plan before code.** Non-trivial task ⇒ short Route Plan in `docs/plans/<task>.md` (scenarios IDs, layers, evidence) — see `docs/plans/stage-0-foundation.md`.
2. **Prefer vetted templates/official generators** over writing from scratch; record the source + what was adapted.
3. **Tests first for behavior.** Every scenario ID you touch gets a test at the lowest layer that can falsify it, plus an E2E/DB test if wiring matters. Show a **negative control** (test fails for the right reason on a deliberately broken version).
4. **Evidence, not claims.** Report PASS/FAIL/PARTIAL/BLOCKED/NOT TESTED with the exact SHA. Mock-backed ≠ integration evidence. Never claim "secure".
5. **Before any library API use, check current docs (Context7) and run `npm run typecheck` after installing** (lesson: `@supabase/ssr` breaking change).
6. **Security guardrails** (docs/05): RLS enabled+forced on every public table; no anon grants; `SECURITY DEFINER` only in `private` with `search_path=''`; secret-key client only via `platform/system-db`; Zod at every boundary; tenant always from session; no PII in logs; email links never change state on GET.
7. DB changes: forward-only migration in `supabase/migrations`, pgTAP test in `supabase/tests/database`, `private.lint_violations()` must be empty.

## Commands
`npm run lint` · `npm run typecheck` · `npm test` · `npm run build` · `npm run test:e2e` (needs a build) · `npm run db:start` · `npm run db:test` · `npm run db:lint`

## Tooling in this repo
Full register (installed / deliberately skipped / later): `docs/06-tooling-register.md`.
- Plugins (declared in `.claude/settings.json`): **superpowers** (TDD, debugging, plans, verification, review), **ui-ux-pro-max**, **supabase** (postgres best practices), **design** (accessibility-review, design-critique, ux-copy).
- Code graph: **graphify** (local-only `graphify-out/`; `npm run graph:build`; query the `graphify` MCP before grepping a growing codebase).
- MCP (`.mcp.json`, pinned): Playwright, Chrome DevTools. Project commands: `/design-review` (needs a live preview), `/pragmatic-code-review`. Built-in: `/security-review`, `/code-review`, `/simplify`.
- Cloud connectors: Supabase (`get_advisors` after every DDL), Vercel, GitHub, Context7 (current docs before any library API), Figma.
- Security scanners: gitleaks, trivy, osv-scanner (CI + local), CodeQL (CI).
