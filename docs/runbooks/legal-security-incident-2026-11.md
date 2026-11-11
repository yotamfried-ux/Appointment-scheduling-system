# Tori — security incident and litigation evidence runbook
Status: DRAFT / tabletop not yet performed. Owner is incident lead until a backup contact is designated.

## Immediate response
1. Open incident record with UTC discovery time, reporter, impacted systems, first evidence, and incident ID. Never paste secrets or full personal records into tickets.
2. Preserve immutable or access-restricted evidence (redacted logs, deployment SHA, provider event IDs, DB audit metadata, screenshots, access grants). Record collector, time, hash, custody and storage location.
3. Contain: revoke compromised tokens, rotate credentials, disable affected integration, block malicious traffic, isolate affected tenant where possible. Require owner approval for destructive production actions.
4. Assess affected data categories, number of people, cross-tenant scope, access, exfiltration, integrity and availability. Consider whether security level is medium/high and whether event is legally 'serious'.
5. Escalate to privacy counsel immediately when serious incident suspected; submit mandatory notice **immediately** when the law requires it. Official authority: https://www.gov.il/he/pages/reporting_security_breach ; reporting form: https://www.gov.il/he/service/report-of-data-breach .
6. Inform affected business controllers according to actual contracts and applicable law. Do not delay statutory notice while waiting for perfect forensics; update as facts emerge.
7. Recover using clean infrastructure and tested restore procedures. Verify tenant isolation, integrity and deleted-record handling before re-enabling traffic.
8. Record decisions, owners, times, approvals, communications, root cause, remediation and verification. Hold postmortem and exercise corrective controls.

## Readiness gates
- [ ] Backup contact and secure out-of-band channel recorded.
- [ ] Vercel, Supabase, Resend security alert paths tested.
- [ ] Production backup restoration exercised in isolated environment, without copying customer data to unsecured devices.
- [ ] Emergency access, secrets rotation and rollback tested.
- [ ] Severity rubric and notification templates reviewed by Israeli privacy counsel.
- [ ] Annual tabletop and after-change review scheduled.
- [ ] Contractual notification obligations and insurance reviewed.

This process reduces risk and preserves evidence. It cannot prevent claims or guarantee a successful defense.
