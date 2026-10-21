# Legal and privacy evidence set (2026-10-14)

Prepared with the Engineering-OS legal-compliance library (PR 298, `docs/legal-compliance/*`), applied to what the code and the cloud test environment actually do.

**This is engineering evidence for counsel. It is not legal advice and it approves nothing.** Every public text stays DRAFT until a qualified person signs it (checklist A6). The legal status of each area is one of `READY_FOR_COUNSEL`, `BLOCKED`, `NOT_ASSESSED`, `NOT_APPLICABLE`; this repository never writes `LEGAL_REVIEW_APPROVED`.

| File | What it is |
|---|---|
| [open-decisions.md](open-decisions.md) | **start here**: what the owner decided, what was built, and the gaps to close before production |
| [legal-qualification.md](legal-qualification.md) | scope facts, regimes considered (applies / conditional / not assessed), 11-row legal evidence matrix with status, open questions for counsel |
| [data-map.md](data-map.md) | personal-data ledger and processing register, from the schema |
| [processors-and-transfers.md](processors-and-transfers.md) | vendors, what each receives, locations known and unknown |
| [retention-deletion-matrix.md](retention-deletion-matrix.md) | how long each category lives, what deletes it, what is not tested |
| [privacy-rights-workflow.md](privacy-rights-workflow.md) | how access, correction and deletion requests are handled today |
| [audit-checklist.md](audit-checklist.md) | the library checklist walked item by item: PASS / PARTIAL / FAIL / NOT TESTED / NOT APPLICABLE with the evidence |

Rules followed: reality before claims (every sentence below is traceable to code, migration, test or console output); unknown is written `unknown`, never guessed (for example residency of backups); no "compliant" or "secure" claim anywhere.
