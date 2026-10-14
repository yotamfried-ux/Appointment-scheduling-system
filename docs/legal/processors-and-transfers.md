# Vendors and transfers (processors register, 2026-10-14)

| Vendor | Role | Data it receives | Location | Contract / DPA | Deletion / export support | Status |
|---|---|---|---|---|---|---|
| Supabase | database, sign-in, backups | everything in [data-map.md](data-map.md) | cloud test project: `ap-southeast-1` (Singapore) per the Supabase console on 2026-10-14; **production region: unknown (owner decision)**; backups: **unknown** | **none on file** | rows deleted by the product's own purge; backup expiry per Supabase plan (unknown) | `REVIEW_REQUIRED` |
| Vercel | hosting, serverless functions, cron | requests in transit; runtime logs; env secrets | functions observed in `iad1` and `pdx1` (runtime logs); logs retention unknown | **none on file** | logs expire by plan | `REVIEW_REQUIRED` |
| Resend | e-mail delivery (production provider; the test environment uses the fake provider and sends nothing) | recipient address, subject, body (booking details, never intake answers) | provider decision pending (A4) | **none on file** | provider suppression via webhook (`/api/webhooks/resend`) | `REVIEW_REQUIRED` (not yet live) |
| GitHub / GitHub Actions | source and CI | synthetic test data only (no personal data); cloud simulation books one appointment with a synthetic name on the test project | US | n/a | n/a | `APPROVED` for engineering use; keep real personal data out of CI |
| Payment provider | none yet (manual/fake) | none | n/a | n/a | n/a | `NOT_APPLICABLE` until real billing (A3/A5, library item 44) |
| Analytics, ads, error tracker, AI | **none in the product** | none | n/a | n/a | n/a | `NOT_APPLICABLE`; tests fail if one appears |

What is true today about transfers: the cloud test database is outside Israel. The privacy draft says the location "will be detailed before launch"; it must name the actual production region and the legal basis for the transfer after counsel's decision. Do not describe any region as final until the production project exists (checklist A1).

Network behavior check (item 42): the browser talks to the site and to the Supabase host named in the Content Security Policy `connect-src`; no other origin is allowed by the policy (`lib/security/csp.ts`), so a third-party SDK would be blocked as well as caught by tests.

Open: DPAs and subprocessor terms for Supabase, Vercel, Resend; written contact for incidents at each; dependency licence scan (SBOM) not run in this session (OSV and Trivy run in CI and passed).
