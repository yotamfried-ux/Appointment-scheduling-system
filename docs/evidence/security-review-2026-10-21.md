# Security review, 2026-10-21 (white-box, by code reading; not a certification)

Strix (the AI pentest agent) was NOT run: it needs an LLM API key that this environment does not have. An equivalent white-box review of all 42 API routes, server actions, proxy, migrations and CI was done instead. No live attack traffic was sent. Never read "no findings" as "secure".

## Fixed in this commit
| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Medium | `next=/%09/evil.com` passed the open-redirect guard of `/auth/confirm` | `lib/auth/safe-next.ts` allow-list + control-character refusal; `tests/unit/safe-next.test.ts` |
| 2 | Medium | Auth e-mail links (reset, confirmation) were built from the request Host / X-Forwarded-Host | `APP_URL` / `NEXT_PUBLIC_SITE_URL` first; headers only when neither is set (Preview) |
| 3c | Low | `/api/public/[slug]/services` wrote a rate-limit row for any junk slug | slug validated before the limiter |

## Open, owner or later work
| # | Severity | Finding | Action |
|---|---|---|---|
| 3a | Medium-Low | `book-biz` 120/min per business can be exhausted by a few IPs, blocking real bookings | tune after real traffic; count only accepted requests |
| 3b | Low | client IP taken from the leftmost `x-forwarded-for`; safe on Vercel (it overwrites), not behind a proxy that appends | use the platform IP header when moving off Vercel |
| 3d | Low | booking/waitlist can send mail to any address (8/h per address); no "this wasn't me" link, no List-Unsubscribe | build with the real mail provider (B5) |
| 4 | Low | fake billing secret `dev-only-billing-secret` and `ALLOW_*` test switches are safe on Vercel Preview/Production but not checked on other hosts | production build is on Vercel; revisit if self-hosted |
| 5 | Low | the long-lived customer "view" token (until appointment + 7 days) lives in the URL | keep paths out of logs; consider a shorter TTL |
| 6 | Info | cron returns 401 not 404 on bad secret (docs/05 says 404) | cosmetic |
| 9 | Info | check Supabase Data API exposes only `public` in production | verify when the production project is created (B3) |
| 10 | Info | auth rate limits are local defaults, no CAPTCHA; public sign-up has no volume limit | set Supabase Auth limits on the production project; decide on CAPTCHA |

## Verified clean (by reading)
Tenant id always from the session; same-origin check on every owner/admin POST; webhooks verify HMAC on the raw body and fail closed; all 28 tables RLS enabled and forced, no anon grants, all SECURITY DEFINER functions in `private` with empty search_path; no raw HTML sinks; CSV/ICS/e-mail output neutralised; no committed secrets; cron fails closed.
