# Incident response (security and privacy) - DRAFT for the owner and counsel

Written from the Engineering-OS legal library (SECURITY-AND-INCIDENT-LAW) and the product's own controls. Roles are placeholders until the owner names people. Nothing here is legal advice: whether an event must be reported, to whom and by when is decided by counsel for the actual facts (the library notes there is no universal 72-hour rule in Israel; deadlines must be researched per incident and vendor contracts may set shorter ones).

## 1. Roles (owner fills in; one person may hold several)
| Role | Person | Contact | Does |
|---|---|---|---|
| Incident lead | _owner to name_ | | decides severity, keeps the record, is the only one who speaks externally |
| Technical responder | _owner to name_ | | contains, investigates, restores |
| Legal contact | _counsel to name_ | | decides notification duties and wording |
| Vendor contacts | Supabase, Vercel, Resend support channels | | provider-side logs, key rotation, takedown |

## 2. What counts as an incident
Exposed secret or key; one business seeing another's data; a leaked export; unauthorized admin access; mail sent to the wrong recipients; data loss or a bad restore; a vendor breach notice; a vulnerability report from outside.

## 3. First hour
1. **Open the record** (copy the template in section 6). Time, who found it, what was seen. Do not paste personal data, tokens or secrets into the record.
2. **Contain**: rotate the exposed secret (`docs/runbooks/secrets.md`); revoke sessions of an affected account; disable the affected route or feature flag; pause a job (`docs/runbooks/jobs.md`); suspend the affected business through the back-office API (platform admin with MFA) if needed. Prefer reversible steps.
3. **Preserve evidence**: Vercel runtime logs and deployment ids, Supabase logs, `audit_log` rows (append-only), request ids shown to users (`req_...`). Do not delete anything.
4. **Assess scope**: which businesses, which data categories ([data map](../legal/data-map.md)), how many people, which period, whether intake answers (sensitive) were involved, whether the data left the tenant boundary.
5. **Call the legal contact** with the facts before any outside message.

## 4. Decide and record
Fill `israel_serious_event` (yes / no / to-assess) and `gdpr_72h_rule_applicable` (only if counsel finds the EU regime in scope) from counsel's answer. If the decision is **not to notify**, write the grounds and the approver. Never write "no personal data was affected" or "your information is safe" before the investigation supports it.

## 5. After
Fix the cause with a test that fails first; rotate anything that could have been seen; tell affected businesses what happened, what data, what we did and what they should do, in plain Hebrew with verified facts only (draft: "אנו בודקים אירוע אבטחת מידע שעשוי להשפיע על ... נעדכן מידע מאומת וצעדים מומלצים בהמשך."); update the data map, the vendor matrix and this runbook; keep the record. Rehearse once in staging with synthetic data before launch and after a major change (gate 9 in `docs/evidence/launch-readiness.md`).

## 6. Record template
```
id:            INC-YYYY-MM-DD-n
detected_at / by:
severity:      low | medium | high | critical
summary (facts only):
systems / businesses affected:
data categories (from the data map):
contained_at / how:
evidence kept (log ids, request ids, audit_log ids):
israel_serious_event:        yes | no | to-assess   (counsel)
gdpr_72h_rule_applicable:    yes | no | to-assess   (counsel)
notified: who / when / by whom   or   not notified: grounds + approver
root cause / fix / test added:
follow-ups (owner, due date):
```
