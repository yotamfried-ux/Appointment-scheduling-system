## Summary
<!-- what and why -->

## Scenarios covered
<!-- IDs from docs/04-scenarios-catalog.md, e.g. BKG-02, SEC-01 -->

## Evidence (exact revision)
| Layer | Result (PASS/FAIL/PARTIAL/BLOCKED/NOT TESTED) | Notes |
|---|---|---|
| Unit | | |
| DB / pgTAP | | |
| E2E | | |
| Security (docs/05) | | |

## Checklist
- [ ] Negative control: a relevant defect makes the new test fail for the expected reason
- [ ] New tables: RLS enabled + forced, no anon grants, `private.lint_violations()` is empty
- [ ] No secrets, no PII in logs/fixtures
- [ ] Docs / decision log updated if a decision changed
