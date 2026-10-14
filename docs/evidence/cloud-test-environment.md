# Evidence — the test environment in the cloud (first deployment, 2026-10-13)

What was verified, by whom, and what is still open. Nothing here is production: no real mail, no payments, fake providers (`docs/runbooks/deploy-test-environment.md`).

| Item | Result | Evidence |
|---|---|---|
| Supabase project (test, region ap-southeast-1) | created by the owner | `list_projects` |
| Schema | **22 of 22 migrations applied**, `private.lint_violations()` returned 0 rows | Actions run "DB push (test project)", method `api`, job log |
| Reads from the project | `public` has 27 tables, `plans` has 2 rows, `service_role` may read it | SQL read through the Supabase tool |
| Vercel project, Preview deployment of this branch | builds and runs; CI green on the same commit | deployment state READY, `/api/health` is 200 |
| `/api/ready` | **503 until the secret key is available in the Preview environment**; the runtime log gives the reason as one fixed word (`not_configured` while a variable was missing) | runtime log `{"event":"db_not_ready","reason":"..."}` |
| Demo user and business | **not created yet** (needs `SUPABASE_SECRET_KEY`, which only the owner holds) | `scripts/seed-demo.mjs`, run by the owner |

Problems met on the way and how they were solved (also in the runbook): the free Hobby plan refuses `*/5` crons (daily now, production values in `docs/runbooks/jobs.md`); a deployment labelled Production is refused by `check-env` on purpose, so everything is set for **Preview** and the Production Branch is `main`; a typo in a variable name (`NEXT_SUPABASE_URL`) and a variable set for Production only both look like `not_configured`; a database password with special characters broke the CLI connection, so the migrations workflow got a token-only method.
