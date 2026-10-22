# Abuse of a booking page: report, takedown, name review (2026-10-22)

A booking page lives on our domain, so someone could name a business after a bank or an authority to phish visitors (docs/05 §5.11, Strix VULN-0011).

## What exists
- **Report link:** every booking page shows "דיווח על עסק זה" (a mail to the contact address with the business link in the subject). It appears only while `NEXT_PUBLIC_LEGAL_CONTACT` is set.
- **Name screen:** a business whose name contains a sensitive term (banks, card companies, authorities, health funds, well-known platforms; list in `private.sensitive_name`, migration `20261042`) can be created but **not published** until an operator approves the name. The owner sees a message asking to write to the contact address.
- **Kill switch:** an operator takes a published page down at once; a suspended business cannot publish itself again. Lifting the suspension leaves the page unpublished until the owner publishes.

## When a report arrives
1. Open the page, decide. If it is a bad page, suspend it (below) and reply to the reporter.
2. Write to the owner. Lifting the suspension is a deliberate step.

## How an operator acts
Two ways, both leave a line in the business's audit log.
- **API** (a platform admin signed in with a second factor): `POST /api/admin/business/suspension` with `{ "businessId", "suspended": true|false, "reason" }`, and `POST /api/admin/business/brand-review` with `{ "businessId", "reason" }`.
- **SQL editor** (always available to the project owner), when no platform admin account exists yet:
```sql
-- take a page down
update public.businesses set suspended_at = now(), published_at = null where slug = '<slug>';
-- approve a sensitive name
update public.businesses set brand_reviewed_at = now() where slug = '<slug>';
-- lift a suspension (the owner publishes again)
update public.businesses set suspended_at = null where slug = '<slug>';
```
The SQL route writes no audit line; add one by hand if it matters.

## For the pilot
A name that matches the list is held until approved. If the pilot business's name contains a listed term, approve it with the second statement above right after she creates the business.
