# Deploying a test (staging) environment

For trying the system in the cloud before production: a Vercel deployment plus its own Supabase project, with **no e-mail sent and no payments** (the fake providers). Nothing here is a production setup: production has its own gate (`npm run check:env` with `VERCEL_ENV=production`), which refuses everything below on purpose.

## 1. Supabase (its own project — never one that belongs to something else)
1. Create a project (suggested name `easylife-test`). Note its **ref** (the 20 characters in its URL) and, from *Project settings → API*, the URL, the **publishable** key and the **secret** key.
2. Apply the schema: `npx supabase link --project-ref <ref>` then `npx supabase db push` (forward-only migrations in `supabase/migrations`). Afterwards run the schema lint against it (`select * from private.lint_violations()` must return no rows).
3. *Authentication → URL configuration*: Site URL = the Vercel URL, Redirect URLs = `https://<that-url>/**`. *Authentication → Providers → Email*: confirm e-mail **on**, minimum password length **12** (the repo's `supabase/config.toml` only configures the local stack; the cloud setting is separate).

## 2. Vercel
1. New project from the GitHub repository, branch `claude/optimistic-hypatia-wh3zo3` (or `main` once merged). Framework: Next.js, build command: default (`npm run build`).
2. Environment variables (scope **Preview**, or Production if this project is only a test):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the publishable key |
| `SUPABASE_SECRET_KEY` | the secret key — **enter it yourself in the Vercel dashboard**, never in chat or in a file |
| `BOOKING_TOKEN_SECRET` | 32+ random characters (`openssl rand -base64 36`) |
| `CRON_SECRET` | 16+ random characters |
| `NEXT_PUBLIC_SITE_URL`, `APP_URL` | the deployment URL, `https://…` |
| `ALLOW_NON_PRODUCTION_DEFAULTS` | `1` — Vercel runs every build with `NODE_ENV=production`, so without this the app treats a test as production and refuses the fake providers. **Never set this in a production environment** (`check:env` refuses it there) |
| `EMAIL_PROVIDER` | `fake` (nothing is sent) |
| `BILLING_PROVIDER` | `fake`, plus `BILLING_WEBHOOK_SECRET` (any 16+ characters), or `manual` |

3. *Deployment Protection*: a Preview deployment is behind Vercel login by default. To open the link to someone without a Vercel account, turn protection off for that project or create a bypass link.
4. Crons (`vercel.json`) run every 5–15 minutes, which the free Hobby plan does not allow (daily only): without them reminders and offers do not run, everything else works. Either use a paid plan or call the four `/api/jobs/*` URLs from another scheduler with `Authorization: Bearer $CRON_SECRET`.

## 3. A test user and a demo business
From a machine that has the three Supabase values in its environment (do not commit them):

```
DEMO_EMAIL=you@example.com APP_URL=https://<deployment-url> \
  node scripts/seed-demo.mjs --confirm-project=<ref>
```
It prints the sign-in address, the e-mail, a generated password (shown once) and the customers' booking page. It refuses to run without `--confirm-project=<ref>` (so it cannot be pointed at the wrong project), creates a confirmed user (no mail needed), creates and publishes a demo barbershop through the app's own functions, and is safe to run again (`--reset-password` sets a new password).

## 4. Check it works
`GET /api/health` → 200 · `GET /api/ready` → 200 (database reachable) · sign in with the demo user → dashboard shows the business as published · open the booking page in a private window and book a slot · the dashboard shows it.

## What this does not prove
Real e-mail delivery (Resend, SPF/DKIM/DMARC), a payment provider, backups/PITR, or production-grade limits. Those are launch checklist items A1–A6.


## Lessons from the first cloud deployment (what went wrong and how to tell)
- **A deployment marked `Production` always fails here, by design.** `npm run build` runs `check-env`, which refuses test switches (`ALLOW_NON_PRODUCTION_DEFAULTS`, fake providers) in Production. The project's *Production Branch* must be `main`, so this branch deploys as **Preview**; and every variable in this runbook is set for **Preview only**. When "Redeploy" is used, pick a deployment of the branch that is *not* labelled Production (or just push a commit).
- **Names are exact.** `NEXT_PUBLIC_SUPABASE_URL` (not `NEXT_SUPABASE_URL`), type *Config* (the `NEXT_PUBLIC_` prefix means "visible to the browser"); `SUPABASE_SECRET_KEY` has no `NEXT_PUBLIC`, type *Secret*. A variable set only for Production does not exist in Preview.
- **`/api/ready` answers 503 `{"status":"unavailable"}` and nothing else, on purpose.** The reason is one fixed word in the Vercel runtime log (`{"event":"db_not_ready","reason":"..."}`): `not_configured` (URL or secret key missing in this environment), `invalid_key_format` (for example a line break pasted with the key), `http_401` (the database service refused the key), `unreachable_or_timeout`, `db_<code>` (the database refused the read).
- **Migrations:** the Actions workflow `DB push (test project)` applies them. Method `api` needs only `SUPABASE_ACCESS_TOKEN`; method `cli` also needs `SUPABASE_DB_PASSWORD` (use letters and digits only: a password with `@ # % / :` breaks the connection string). It is idempotent and ends by asserting that `private.lint_violations()` is empty.
- **The Hobby plan** refuses any cron more often than daily; `vercel.json` is daily for this reason (see `jobs.md` for the production values).
- **`NEXT_PUBLIC_*` variables are compiled in at build time.** Adding or fixing one has no effect on an existing deployment: it needs a NEW build (push a commit, or Redeploy a Preview of the branch with the build cache off). Without `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` every page that signs anyone in crashes ("Your project's URL and Key are required"). `/api/ready` now checks both public variables and answers 503, with `{"event":"public_config_missing","variables":[...]}` (names only) in the runtime log.
- **Vercel Deployment Protection** puts Vercel's own login page in front of every Preview for anyone not signed in to Vercel (HTTP 200 on a page titled "Log in to Vercel"). The owner sees the app because they are signed in; a customer, a phone or the cloud simulation does not. For a test environment either switch "Vercel Authentication" off for Preview, or create a *Protection Bypass for Automation* secret and store it as the repository secret `VERCEL_BYPASS` (the simulation sends it as a header). The simulation fails with that explanation instead of testing Vercel's page.

## Preview variables checklist (2026-10-20)
Set for the **Preview** environment only (mark secrets Sensitive), then trigger a build by pushing a commit (the dashboard's Redeploy rebuilds the *old* commit, and as Production it is refused by `check:env`):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `BOOKING_TOKEN_SECRET` (32+ random characters; without it every booking fails and `/api/ready` answers 503), `CRON_SECRET`, `APP_URL` and `NEXT_PUBLIC_SITE_URL` (the Preview address), `EMAIL_PROVIDER=fake`, `BILLING_PROVIDER=manual`, `ALLOW_NON_PRODUCTION_DEFAULTS=1`.
Owner-side cloud simulation: GitHub secrets `CLOUD_OWNER_EMAIL` and `CLOUD_OWNER_PASSWORD` (a test account). To get a new password: run the "Seed demo user (test project)" workflow with `reset_password` ticked; the password is printed once in that run's log.
