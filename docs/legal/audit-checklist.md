# Audit against the legal library checklist (65 items, 2026-10-14)

Engineering status only (PASS / PARTIAL / FAIL / NOT TESTED / NOT APPLICABLE), per exact revision on branch `claude/optimistic-hypatia-wh3zo3`. It never says "compliant". Legal status is in [legal-qualification.md](legal-qualification.md).

## A. Scope and data inventory
| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | legal-scope facts recorded | PARTIAL | [legal-qualification.md](legal-qualification.md); operator identity unknown |
| 2 | personal-data ledger per flow | PASS | [data-map.md](data-map.md) |
| 3 | per-field purpose, visibility, reminders operational | PASS | data-map; templates: no promotion in any mail (`modules/notifications/templates.ts`) |
| 4 | free text, IPs, logs, shadow copies | PARTIAL | no error tracker/analytics; rate counters hold hashes; Vercel log retention unknown; seed data is synthetic |
| 5 | health-adjacent kinds | **FAIL (open decision)** | sensitive optional intake fields exist for beauty, nails, trainer, clinic; provider-only, never in mail, cleared on anonymise; counsel decision required |
| 6 | minimise | PASS | only name, phone (required), e-mail (optional, required for waitlist), intake optional |
| 7 | Israel conditional items assessed | NOT TESTED | all `NOT_ASSESSED` (counsel) |
| 8 | no invented residency | PASS | test DB region read from console (Singapore); production `unknown` and written as such |

## B. Notices at collection
| 9 | point-of-collection notice (booking form, owner sign-up) | PASS | booking details step links the privacy policy under the form (`details.consent` in `messages/he.json`); sign-up shows terms/privacy acceptance; E2E public-booking-ui |
| 10 | optional fields visibly optional, booking not tied to marketing | PASS | labels "(לא חובה)"; no marketing exists |
| 11 | privacy notice linked, anonymous, mobile, contact and version | PARTIAL | links in footer on every public page, version/date shown (`LEGAL`); **contact is a visible placeholder** until `NEXT_PUBLIC_LEGAL_CONTACT` is set (A6) |
| 12 | notice sentences match behavior | PARTIAL | sentences checked against code here; server location and retention text still "to be detailed before launch" (honest, incomplete) |
| 13 | acceptance of document versions recorded | PASS | `legal_acceptances`; gate `lib/legal/gate.ts`; E2E `legal-calendar.spec` |

## C. Cookies and trackers
| 14 | inventory of every cookie/SDK/storage | PASS | `lib/legal/content.ts` COOKIES_ESSENTIAL; **new** `tests/e2e/consent-cookies.spec.ts` asserts it on a fresh profile |
| 15 | banner necessity decided, disclosure kept | PARTIAL | decision recorded in code comment (no optional category, so no banner); counsel confirmation pending |
| 16-17 | granular choice, persisted, withdraw | NOT APPLICABLE today | `OPTIONAL_CATEGORIES` is empty by design; `tests/unit/consent.test.ts` proves the gate stays closed until a category is registered and chosen |
| 18 | banner before SDK init | NOT APPLICABLE (no SDK) | covered by item 14 test |
| 19 | event tests | PARTIAL | fresh_user_no_choice PASS (new test, mobile+desktop run); reject/analytics/withdraw NOT APPLICABLE |
| 20 | embeds and third-party traffic | PASS | new test fails on any origin other than the site and the database host; CSP `connect-src` names only the database host |
| finding | `lab-session` entry in session storage on the public booking page | **FIXED** | a random per-tab id used only by the design lab was created for real visitors; now only the lab creates it; the test caught it |

## D. E-mail, reminders, marketing
| 21 | operational vs promotional separated | PASS | templates: confirmation, decline, cancellation, reminder, waitlist offer, owner digest; none promotional |
| 22-24 | marketing opt-in, unsubscribe, suppression, identity | NOT APPLICABLE | no marketing. Bounce/complaint suppression exists (`email_suppressions`, Resend webhook) |
| 25 | no tokens or sensitive content in logs, subjects | PASS | subject never names the service (`templates.ts` comment, unit tests); intake never in mail; notification_log stores a hash, no body |
| 26 | no invented urgency, reviews, claims | PASS | landing page rewritten today without prices, reviews, counters; `tests/e2e/landing.spec.ts` asserts no currency sign |

## E. Rights and retention
| 27 | one discoverable route | PARTIAL | owner: export and delete in the product; end customer: "ask the business" ([privacy-rights-workflow.md](privacy-rights-workflow.md)) |
| 28 | request record, identity check | PARTIAL | no ticket register (P2) |
| 29 | deletion across systems and vendors | PARTIAL | database yes (tested); vendor logs/backups unknown ([retention-deletion-matrix.md](retention-deletion-matrix.md)) |
| 30 | completion evidence, edge cases | PARTIAL | `has_upcoming`, already-anonymised, forbidden covered in pgTAP; unverifiable-requester path not built |
| 31 | retention per category | **FAIL (gap)** | appointments and customers of an active business have no age limit; technical rows do |
| 32 | delete-account copy does not over-promise | PASS | privacy draft promises only what is tested |

## F. Security with legal consequences
| 33 | security level classification | NOT TESTED | counsel |
| 34 | tenant isolation | PASS | RLS forced on every table; `tenancy.spec`, `permission-matrix.spec` (every owner/admin route for every caller kind), pgTAP |
| 35 | no fake confirmation, atomic booking, idempotency | PASS | `load-smoke` (60 customers, 12 slots, exactly 12 win), `public-booking`, idempotency tests |
| 36 | no PII in logs, no service key in frontend | PASS | `scripts/check-bundle.sh`, Gitleaks and Trivy in CI; logs carry fixed event words |
| 37 | MFA, access review, transport and at-rest encryption | PARTIAL | MFA (TOTP) built and tested; TLS and HSTS set; at-rest encryption is the provider's; access review process not written |
| 38 | audit logging, vulnerability management | PARTIAL | audit_log append-only; CodeQL, OSV, Trivy, Gitleaks in CI (green on the last runs); logical restore rehearsal exists and is scripted (`scripts/drills/restore.sh`, runbook `restore.md`); Supabase point-in-time recovery itself NOT TESTED (needs the production project) |
| 39 | incident plan with roles | **PARTIAL (draft written today)** | `docs/runbooks` has no incident-response page with roles and notification decision record |
| 40 | no "100% secure" claims | PASS | privacy draft says no system is fully immune |
| extra | Supabase advisor | PARTIAL | security advisor: leaked-password protection is disabled (Auth setting; requires the provider's paid tier, owner action); 8 INFO "RLS enabled, no policy" are intentional service-only tables |

## G. Vendors and licences
| 41 | vendor matrix with DPA status | PARTIAL | [processors-and-transfers.md](processors-and-transfers.md); no DPAs on file |
| 42 | SDK behavior matches the notice | PASS | no third-party SDK; origin test |
| 43 | OSS licence audit | NOT TESTED | OSV (vulnerabilities) runs in CI; licence/SBOM scan not run |
| 44 | payment provider terms | NOT APPLICABLE | billing manual/fake |

## H. Commerce
| 45 | total, renewal, cancel terms shown before signup | NOT APPLICABLE today | no real charging; trial and plan page show what a plan contains; recheck when a provider is connected |
| 46 | cancellation and refund route | PARTIAL | customer cancels through a signed link inside the stated window, tested; refunds do not exist |
| 47 | review-before-confirm and honest failure | PASS | booking summary step, conflict handling, a failed or conflicting booking never shows success (`public-booking-ui`) |
| 48 | manual billing not presented as real | PASS | billing page says manual setup (`billing.manualDesc`) |
| 49 | provider role clarified | PARTIAL | terms section "customers of the business"; counsel |

## I. Accessibility
| 50 | applicability decision | NOT ASSESSED | counsel |
| 51 | keyboard, screen reader, contrast, focus, RTL, reduced motion, zoom, targets | PARTIAL | axe WCAG 2.2 AA on every public and owner page in E2E (mobile 360 and desktop); 44px targets tested; reduced motion now tested with a negative control (`reduced-motion.spec.ts`); **no manual screen-reader or external audit** |
| 52 | statement truthful | PASS | `A11Y` draft states automated and internal testing only and no external audit |

## J. Platforms and minors
| 53 | app stores | NOT APPLICABLE | web only |
| 54 | minors | NOT ASSESSED | counsel (therapy/clinic kinds) |
| 55 | public images, reviews | NOT APPLICABLE | none used |

## K. Release-gate tests
| 56 | legal links resolve anonymously, mobile | PASS | `legal-calendar.spec`, `landing.spec` |
| 57 | collection copy matches purpose, no hidden SDK | PASS | items 9, 20 |
| 58 | consent-required trackers inactive | NOT APPLICABLE | no trackers |
| 59 | signup records actual document versions | PASS | item 13 |
| 60 | marketing opt-out suppresses queued sends | NOT APPLICABLE | no marketing |
| 61 | delete-account end to end | PASS | `account.spec`, journey 5 |
| 62 | cost preview matches charge | NOT APPLICABLE | no charge |
| 63 | negative paths never show success | PASS | conflict and failure tests |
| 64 | store labels vs SDK | NOT APPLICABLE | no store |
| 65 | build scan | PASS | Gitleaks, Trivy, CodeQL, OSV green; licence scan NOT TESTED |
