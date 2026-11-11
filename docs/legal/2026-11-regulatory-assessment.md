# Tori / D2R — Israeli regulatory assessment (working counsel brief)
Date: 2026-11-11. Status: ENGINEERING DRAFT — not legal approval.

## Confirmed operating facts
- Owner intends to register as an exempt dealer in **early January 2027**. No business registration number may be displayed until verified.
- Israel-targeted multi-tenant appointment SaaS; businesses manage their clients' appointments.
- Supabase project `appointment-system-frankfurt` (`abhadytskhgwkrlmceew`) was observed ACTIVE_HEALTHY in `eu-central-1` on 2026-11-11. This does NOT establish all vendor log, backup, or subprocessor locations.
- Production Vercel account could NOT be accessed with the current Vercel connector: only an unrelated video project was listed. Account-level plan, DPA applicability and production deployment remain UNVERIFIED.
- The legal source `lib/legal/content.ts` contains public privacy/terms text. The older `processors-and-transfers.md` is outdated.
- Supabase security advisor returned seven **INFO** notices for RLS-enabled internal tables without policies; this is not proof of exposure. Verify grants and intended service-role access before changes.

## Israeli Privacy Protection Law / Amendment 13 — decision matrix
1. **Registration**: Under the Privacy Authority's Amendment 13 FAQ, registration generally concerns public bodies or databases whose primary purpose is collecting information to transfer it to others commercially, with 10,000+ people. An appointment processor is NOT automatically a data broker. Confirm controller/holder roles, all processing purposes, and whether any other database meets a category.
2. **Notification**: Non-registrable databases containing specially sensitive personal information on **more than 100,000** individuals may require notice within 30 days. Current headcount and any incidental sensitive notes are UNVERIFIED.
3. **DPO**: Required for specified public bodies, large-scale systematic monitoring, or large-scale specially sensitive processing and other statutory cases. Do not assert an exemption merely because the business is small. Obtain scale, categories, and processing role before conclusion.
4. **Data security level**: Classify every database under the 2017 Information Security Regulations by purpose, types of information, subjects, authorized users, and applicable criteria. A small-business simplified track may apply only if all conditions are satisfied. Document the rationale.
5. **Collection notice**: Review each booking/waitlist/account form for statutory notice: purposes, whether provision is mandatory, consequences of refusal, recipient details, and data-subject rights as applicable.
6. **Foreign transfers**: Check Israeli transfer regulations, contractual safeguards, subprocessors, and actual processing regions; Frankfurt location alone is not enough.
7. **Security incidents**: A serious incident in a medium/high-security database can require immediate notice to the Privacy Authority. Classify and document promptly; never promise immunity or fixed response deadlines inconsistent with law.

## Accessibility — Israel
- A new public service website generally must be accessible unless a lawful exemption applies.
- The Commission's official guidance states an **exempt dealer** or annual turnover below **NIS 120,000** may qualify for a self-exemption; applicability and required supporting records must be confirmed. Planned registration in January 2027 is not current exempt-dealer status.
- Do not claim WCAG/Israeli Standard 5568 conformance solely because an accessibility statement exists or automated tests pass.
- Test keyboard-only journeys, visible focus, form errors, labels, contrast, RTL, zoom/reflow, screen-reader behavior, dialogs, booking, owner onboarding, cancellation and mobile.
- Keep a defect log and either evidence of full remediation or a documented lawful exemption. Counsel should verify whether the operator qualifies.

## Before counsel approval — factual questions
- Legal operator's name and registered address, tax registration status, service launch and first paid customer date.
- Number of businesses, customer records, minors, sensitive categories, and all authorized users.
- Whether therapy/medical customers are permitted and whether notes can contain medical information.
- Actual production Vercel team/project and plan; Resend account plan and DPA; Supabase organization plan.
- Business customer DPA acceptance mechanics, all vendor/subprocessor retention and regions.
- Backup restoration evidence and actual backup/log retention.
- Accessibility revenue/exemption eligibility and external/manual audit.
- Whether marketing or payments are enabled in production.

## Sources (official)
- https://www.gov.il/he/pages/tikun13_qa
- https://www.gov.il/he/service/notice-obligation
- https://www.gov.il/he/pages/amendment-13-26-07-26
- https://www.gov.il/he/pages/website_accessibility
- https://www.gov.il/he/pages/reporting_security_breach
- https://www.gov.il/he/pages/management_by_an_individual

## Approval gate
No conclusion of legal compliance, immunity from litigation, DPA acceptance, or accessibility certification is made by this document. Counsel to sign off legal interpretations, contracts, notices, and residual risks.
