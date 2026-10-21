You are security-testing "Tori", a multi-tenant appointment-booking web app for small businesses in Israel (Hebrew, RTL). Next.js 16 App Router, Supabase (Postgres with row-level security, Auth), Vercel. Roles: platform admin, business owner/admin/staff, anonymous customers who book through public pages and manage a booking through signed links. No payments are live.

Targets: the source code (white-box) and the running app at http://localhost:3100. It runs against a LOCAL Supabase stack that is thrown away after this run. The public Supabase publishable key is public by design (it is in the browser bundle), so the DATABASE must hold the line when it is used directly against the REST/RPC endpoints of the local stack.

Test accounts: read strix-credentials.txt in the repository root (two separate business owners, A and B, each with a published business). Use them for cross-tenant tests. Public booking pages are /book/scan-owner-a and /book/scan-owner-b. Sent e-mails land in the local mailbox (Inbucket) at http://localhost:54324.

Read first: docs/05-security-architecture.md (intended guardrails: verify them, do not trust them), docs/04-scenarios-catalog.md (scenario IDs), docs/evidence/security-review-2026-10-21.md (findings already known and fixed: do not report them as new).

Focus, in this order:
1. Tenant isolation / IDOR: owner A reading or changing owner B's appointments, customers, services, settings, exports, waitlist; staff vs owner vs admin escalation; direct REST/RPC calls with a signed-in user's token against every table and function.
2. Auth: sign-up, login, reset, MFA; account enumeration; open redirects (/auth/confirm?next=); session cookies; host-header-derived links; brute force limits.
3. Public booking and customer links (/book/<slug>, /booking/<token>, /waitlist/<token>): token forging and replay, enumeration, cancelling someone else's booking, double-booking races, idempotency-key abuse, rate-limit bypass (X-Forwarded-For), slug squatting and redirects.
4. Input handling: stored and reflected XSS in business names, service names, customer notes, e-mail templates; CSV export formula injection; .ics injection; SQL/command injection; SSRF; header injection.
5. Cron and webhook endpoints (/api/jobs/*, /api/webhooks/*): authentication, signature checks, replay.
6. Information leakage: stack traces, error messages, response headers, source maps, secrets in the client bundle, personal data in URLs or logs.
7. Business-logic abuse: using public forms to send e-mail to arbitrary addresses, cheap resource exhaustion, plan or entitlement bypass.

Out of scope: denial of service and load tests, social engineering, anything against third-party services, real e-mail, anything outside the local stack.
Rules: safe, non-destructive tests only; verify every finding by reproduction and mark unverified ones as UNVERIFIED; no "secure" claims; do not modify the repository. For each finding give severity, location (file:line or URL), exact reproduction requests, impact and a minimal fix. Also list what was tested and found clean, and what could not be tested.
