# Legal qualification (reconciled 2026-11-14)

Product: "תורים" (brand) / D2R (operator), multi-tenant appointment-booking SaaS for small businesses, web only. Environments: local (pgTAP, Playwright), Production (Vercel `fra1` + Supabase `eu-central-1` `abhadytskhgwkrlmceew`, historical Singapore test project deleted).

## 1. Scope facts (reconciled)
| Fact | Value | Source |
|---|---|---|
| Operator legal entity, address, contact | Operator name **D2R** (brand **"תורים"**; explicitly NOT "בע\"מ"); official contact **`yotam.fried@gmail.com`** active in `lib/legal/config.ts`; tax registration target January 2027 (no invented ID number; disclosed honestly in `Operator`). See [open-decisions.md](open-decisions.md) G-01 | `lib/legal/config.ts`, `components/legal/operator.tsx` |
| Markets | Israel only (owner decision 2026-10-20), Hebrew/RTL. EU/UK/US targeting: none in code | `lib/legal/content.ts`, `next.config.*` |
| Audiences | B2B: business owners/staff (account holders, 18+). B2C: end customers of each business (name, phone, e-mail, optional notes) | schema |
| Roles | Dual role explicitly formalized in `PRIVACY#who` & `TERMS#dpa` (v. `2026-11-14`): **Business = Data Controller**, **D2R = Data Processor / Holder** for end-customer appointment records; **D2R = Data Controller** for business accounts, security, billing & anti-abuse. **Counsel review recommended** | `lib/legal/content.ts` (`PRIVACY#who`, `TERMS#dpa`) |
| Minors / health | Sensitive intake fields (allergies, goal, reason) removed on 2026-10-20 (unit test guard). `TERMS#sensitive-data`, `PRIVACY#what`, `TermsAcceptanceBox`, and notes hints explicitly forbid medical/health/ID data in free text; `PRIVACY#minors` requires parent/guardian booking under 18 | `modules/tenancy/business-kind.ts`, `lib/legal/content.ts`, `messages/he.json` |
| Money movement | None live: billing provider is manual/trial (`14-day trial`); future provider: Grow/Meshulam when integrated (`GATE-D` / `LR-13`). Customer prices display-only | `modules/billing`, `TERMS#subscription` |
| Trackers | None: no analytics, ads, third-party embeds, or error trackers. Only essential cookies/storage (`COOKIES_ESSENTIAL`, count = 4). Enforced by `lib/security/csp.ts` & E2E | `lib/consent.ts`, `tests/e2e/legal-calendar.spec.ts` |
| Hosting regions | Production target/live DB: Supabase `abhadytskhgwkrlmceew` in **`eu-central-1` (Frankfurt)**; Vercel **`fra1` (Frankfurt)**; old Singapore project deleted (`open-decisions.md`); Resend `noreply@mail.d2ryf.com`. Vendor dashboard DPA archival pending (`LR-05`) | [processors-and-transfers.md](processors-and-transfers.md) |

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
| 1 | Legal entity and markets | `BLOCKED` until registration details and mailbox exist | name D2R known; registration number, address and mailbox open (G-01, G-02) |
| 2 | Current law sources and scope | `READY_FOR_COUNSEL` | regimes and official URLs listed in this file; verified date 2026-10-14 is the library's, counsel must re-verify |
| 3 | Personal-data inventory | `READY_FOR_COUNSEL` | [data-map.md](data-map.md) |
| 4 | Public privacy notices | `READY_FOR_COUNSEL` | `lib/legal/content.ts` drafts, matched to behavior in [audit-checklist.md](audit-checklist.md) items 11-12; retention and server location still say "will be detailed before launch" (honest, but must be filled) |
| 5 | Terms, consumer rights, accessibility | `READY_FOR_COUNSEL` | terms/subscription draft; governing law line says "per the final legal text" |
| 6 | Cookies, trackers, marketing | `READY_FOR_COUNSEL` | no optional trackers; test fails if any appears |
| 7 | User data rights | `READY_FOR_COUNSEL` | owner export + customer anonymise + account deletion with 14-day grace, all tested; end-customer direct request path is "ask the business" ([privacy-rights-workflow.md](privacy-rights-workflow.md)) |
| 8 | Technical and legal security | `PARTIAL` | strong controls, see audit-checklist F; open: leaked-password protection off on the Supabase project, incident runbook only drafted (roles unnamed), PITR restore not drilled on a production project |
| 9 | Vendors and IP | `PARTIAL` | [processors-and-transfers.md](processors-and-transfers.md); no DPAs on file; OSS licence scan not run in this session |
| 10 | Platform and industry rules | `READY_FOR_COUNSEL`: sensitive intake fields removed; health-adjacent kinds remain selectable (clinic), so notes are the residual risk and the terms forbid sensitive data | business-kind.ts, unit test |
| 11 | Review approval | `NOT_ASSESSED` | no named reviewer; an AI cannot sign |

**Overall: `READY_FOR_COUNSEL`, release authorization NOT GRANTED.**

## 4. Questions only a lawyer or the owner can answer
1. Operator entity, address, contact (A6). 2. Roles: is each business the controller of its customers' data and the platform a processor; is a DPA with subprocessor list needed. 3. Registration/DPO/security-level thresholds under Amendment 13. 4. Whether sensitive intake answers (allergies, rehabilitation goal, visit reason) may be collected at all, and under what notice, for each business kind. 5. Hosting region and transfer basis for production (test DB is in Singapore). 6. ~~Retention periods~~ decided: 3 years after last activity, implemented (D-05). 7. Applicability of internet-cancellation rules to booking cancellation and to the SaaS subscription. 8. Whether the accessibility regulation binds the operator and at what level. 9. Wording of terms: liability, governing law, forum. 10. Incident-notification roles.
