# Owner approval of the legal texts

| | |
|---|---|
| Date | 2026-11-14 (initial approval: 2026-10-21) |
| Approved by | the owner of D2R (the account holder of this repository), by written instruction in the working sessions |
| Documents and versions | privacy policy `2026-11-14`, terms of use (incl. Business DPA) `2026-11-14`, cookies `2026-11-14`, accessibility statement `2026-11-14` (`lib/legal/config.ts`) |
| What changed | 2026-10-21: removed the draft notice. 2026-11-14 (PR #80): upgraded to Calmark-grade Israeli SaaS Terms, embedded Business DPA (`TERMS#dpa`), full Section 11 Privacy Protection Law notices in Privacy Policy & `TermsAcceptanceBox`, No-Show/intermediary disclaimers, Standard Contracts Law balanced liability, IS 5568 accessibility statement, and reconciled `docs/legal/*` evidence files. |

## What this record does and does not say

- The owner instructed on 2026-10-21 to publish official legal documents rather than drafts, and requested in November 2026 to finish PR #80 legal hardening taking inspiration from Calmark and leading appointment platforms per `LEGAL_HARDENING_MASTER_SPEC_2026-11.md`.
- Formal wet/typed confirmation sentence (`"I, [full name], approve the privacy policy and the terms in version 2026-11-14"`) remains to be filled by the owner below (`G-10`).
- Engineering drafted and verified the texts and technical controls (`tests/unit/legal-hardening.test.ts`); external Israeli legal counsel has not yet signed off the texts (`D-10`, `G-07`, `G-14`, `G-15`), so residual legal interpretation risk rests with the owner until counsel review.
- Because `LEGAL.terms.version` and `LEGAL.privacy.version` were bumped to `2026-11-14`, signed-in business owners will automatically be prompted to re-accept at `/legal/accept` (`CMP-03`).

Owner's full name and sentence (to be completed by the owner): ______________________________
