# Legal qualification (draft for counsel)

Product: "תורים", multi-tenant appointment-booking SaaS for small businesses, web only. Revision: branch `claude/optimistic-hypatia-wh3zo3`. Environments: local (pgTAP, Playwright), cloud test (Vercel Preview + Supabase `datohhabfakiacvndvle`).

## 1. Scope facts (from the library's Phase A)
| Fact | Value | Source |
|---|---|---|
| Operator legal entity, address, contact | **unknown** (owner decision; `NEXT_PUBLIC_LEGAL_CONTACT` is a visible placeholder) | docs/08 A6 |
| Markets | Israel, Hebrew/RTL. EU/UK/US targeting: none in code (no locale/currency/ads); **not assessed** by counsel | code |
| Audiences | B2B: business owners (account holders, SaaS customers). B2C: end customers of each business (no account; name, phone, optional e-mail) | schema |
| Roles | Platform vs tenant business: **TO_REVIEW** (for end-customer data the business is likely the controller and the platform a processor; owner/counsel decision) | privacy draft section "who we are" |
| Minors / health | Business kinds include clinic/therapy/trainer/beauty/nails. Optional intake fields marked `sensitive` exist (allergies, fitness goal incl. "rehabilitation", reason for visit). **COUNSEL_REQUIRED** | `modules/tenancy/business-kind.ts` |
| Money movement | None live: billing provider is manual/fake. Prices for customers are display only (no payment taken by the platform) | `modules/billing`, A3/A5 |
| Trackers | None: no analytics, ads, third-party embeds, error tracker. Only essential cookies | `lib/consent.ts` (`OPTIONAL_CATEGORIES` empty), `tests/e2e/consent-cookies.spec.ts` |
| Hosting regions | Cloud test DB: Supabase `ap-southeast-1` (Singapore) per Supabase console; functions ran in Vercel `iad1`/`pdx1` per runtime logs; **production regions, backup location: unknown** | Supabase MCP `get_project`, Vercel runtime logs |

## 2. Regimes considered
| Regime | Status | Why |
|---|---|---|
| Israel Privacy Protection Law incl. Amendment 13 | **applies** (personal data of Israeli businesses/customers); details `NOT_ASSESSED` | library ROUTING |
| Database registration / notice duty, DPO, security-level classification | `NOT_ASSESSED` (conditional by thresholds; counsel) | library DATA |
| Section 11 collection notice | `READY_FOR_COUNSEL`: notices exist at booking and sign-up; completeness is counsel's call | audit-checklist 9 |
| Data Security Regulations 2017 | `NOT_ASSESSED` classification; controls exist (RLS, MFA, audit log, rate limits) | docs/05 |
| Serious security-incident reporting | `NOT_ASSESSED`; incident runbook drafted 2026-10-14 (`docs/runbooks/incident.md`); roles to be named | audit-checklist 39 |
| Consumer Protection (internet cancellation, subscriptions) | `NOT_ASSESSED`; billing not live; the customer-booking cancellation window is shown before confirming | audit-checklist 45-47 |
| Accessibility regulation, SI 5568 | `NOT_ASSESSED` whether it binds this operator; WCAG 2.2 AA automated checks pass (axe on all public and owner pages); no external audit | audit-checklist 50-52 |
| Electronic marketing rules | `NOT_APPLICABLE` today: the product sends operational mail only (confirmation, reminder, waitlist offer, digest). Becomes applicable the day any promotional message exists | audit-checklist 21-24 |
| GDPR, UK, US states, FTC | `NOT_ASSESSED` / out of scope unless EU/UK/US targeting begins | library scope tests |
| App stores | `NOT_APPLICABLE` (web only) | docs/evidence/launch-readiness.md |

## 3. Legal evidence matrix (library RELEASE-LEGAL-QUALITY-GATE, 11 rows)
| # | Row | Status | Evidence / gap |
|---|---|---|---|
| 1 | Legal entity and markets | `BLOCKED` | operator identity unknown (A6) |
| 2 | Current law sources and scope | `READY_FOR_COUNSEL` | regimes and official URLs listed in this file; verified date 2026-10-14 is the library's, counsel must re-verify |
| 3 | Personal-data inventory | `READY_FOR_COUNSEL` | [data-map.md](data-map.md) |
| 4 | Public privacy notices | `READY_FOR_COUNSEL` | `lib/legal/content.ts` drafts, matched to behavior in [audit-checklist.md](audit-checklist.md) items 11-12; retention and server location still say "will be detailed before launch" (honest, but must be filled) |
| 5 | Terms, consumer rights, accessibility | `READY_FOR_COUNSEL` | terms/subscription draft; governing law line says "per the final legal text" |
| 6 | Cookies, trackers, marketing | `READY_FOR_COUNSEL` | no optional trackers; test fails if any appears |
| 7 | User data rights | `READY_FOR_COUNSEL` | owner export + customer anonymise + account deletion with 14-day grace, all tested; end-customer direct request path is "ask the business" ([privacy-rights-workflow.md](privacy-rights-workflow.md)) |
| 8 | Technical and legal security | `PARTIAL` | strong controls, see audit-checklist F; open: leaked-password protection off on the Supabase project, incident runbook only drafted (roles unnamed), PITR restore not drilled on a production project |
| 9 | Vendors and IP | `PARTIAL` | [processors-and-transfers.md](processors-and-transfers.md); no DPAs on file; OSS licence scan not run in this session |
| 10 | Platform and industry rules | `BLOCKED` for health-adjacent kinds until counsel decides (intake sensitive fields) | business-kind.ts |
| 11 | Review approval | `NOT_ASSESSED` | no named reviewer; an AI cannot sign |

**Overall: `READY_FOR_COUNSEL`, release authorization NOT GRANTED.**

## 4. Questions only a lawyer or the owner can answer
1. Operator entity, address, contact (A6). 2. Roles: is each business the controller of its customers' data and the platform a processor; is a DPA with subprocessor list needed. 3. Registration/DPO/security-level thresholds under Amendment 13. 4. Whether sensitive intake answers (allergies, rehabilitation goal, visit reason) may be collected at all, and under what notice, for each business kind. 5. Hosting region and transfer basis for production (test DB is in Singapore). 6. Retention periods for appointments and customers of an active business (today: indefinite until the business or the customer is removed). 7. Applicability of internet-cancellation rules to booking cancellation and to the SaaS subscription. 8. Whether the accessibility regulation binds the operator and at what level. 9. Wording of terms: liability, governing law, forum. 10. Incident-notification roles.
