# Vendor agreement review — evidence and open acceptance
Date: 2026-11-11. Status: PARTIAL. Do not mark vendor DPAs accepted without account evidence.

| Vendor | Public agreement / account evidence | Remaining verification |
|---|---|---|
| Vercel | https://vercel.com/legal/dpa — updated 2026-03-17, effective 2026-03-31; text says DPA applies to Pro and Enterprise customers. Current connector listed only unrelated video project, not Tori. | Identify actual Tori production team, plan, contracting party, DPA effective date; review subprocessor notification subscription, incident terms, retention, regions. |
| Supabase | Tori Frankfurt project `abhadytskhgwkrlmceew` ACTIVE_HEALTHY, `eu-central-1`, observed 2026-11-11. | Retrieve governing Supabase DPA/terms for the actual organization and plan, determine incorporation/signature requirements, subprocessor locations, backup retention, and breach contacts. |
| Resend | Repository describes production SMTP through Resend. | Verify the actual Resend account, plan, DPA acceptance/signature, retention, subprocessor locations, incident notice and deletion. No connector-based account proof obtained. |
| GitHub | Code and CI. | Confirm CI never processes live personal data and secrets remain protected. |
| Grow | Future payment provider; not enabled per project records. | Defer until billing is implemented; review merchant contract, privacy and tax documents before activation. |

## Controller / processor map & embedded Business DPA (`2026-11-14`)
- For end-customer appointment records, the Business is designated as the Data Controller (`בעל השליטה במאגר`) and D2R as the Data Processor (`מחזיק/מעבד`) in `lib/legal/content.ts` (`PRIVACY#who`, `TERMS#customers`). Counsel should verify this characterization for edge cases.
- For platform business accounts, security, billing/subscription status, and anti-abuse logs, D2R acts as Data Controller.
- Supplier DPAs do not replace a written D2R–business processing agreement. Accordingly, **`TERMS` section `dpa` (`lib/legal/content.ts`, v. `2026-11-14`) now incorporates a binding Data Processing Addendum (DPA)** covering documented instructions, processing purposes & duration, data categories & subjects, confidentiality, technical & organizational security measures (aligned with the 2017 Data Security Regulations), authorized sub-processors & EU transfer basis (2001 Transfer Regulations), DSAR & incident notification assistance, and termination deletion/export without promising unverified supplier capabilities.

## Owner actions
1. Confirm actual Vercel Tori team/project and Pro contract.
2. In each vendor account, export applicable terms or evidence of DPA acceptance, date, legal entity, and agreement version.
3. Record who approved each agreement. Do not click acceptance on owner's behalf without explicit approval.
4. Send the contract package and this memo to Israeli counsel before calling the contractual chain closed.
