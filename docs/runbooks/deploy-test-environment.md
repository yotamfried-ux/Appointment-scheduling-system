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
