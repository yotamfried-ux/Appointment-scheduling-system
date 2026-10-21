# Data security baseline (2026-10-21)

Engineering evidence only. It maps what the product and the operation do to the headings the Israeli data-security regulations and the Engineering-OS guide (docs/legal-compliance) ask an operator to be able to show. It does **not** classify the database and it is not legal advice: the security level is gap G-07/G-15 and belongs to counsel or a privacy specialist.

| Heading | What exists | Evidence | Missing |
|---|---|---|---|
| Who may reach the data (access list) | each business sees only its own rows (RLS enabled and forced on every table); roles owner/admin/staff; platform admins in a separate table with MFA required | pgTAP isolation tests, permission matrix e2e, `private.lint_violations()` empty | a written access register of the *people* with dashboard access (today: the owner only) |
| Strong sign-in | passwords checked for length, MFA (TOTP) for owners and required for admin actions, uniform login/reset answers | `mfa.spec`, `auth-journey.spec` | leaked-password protection switch (done by the owner on the production project: confirm in the evidence file) |
| Logging and audit | append-only audit log of management actions; request ids; no personal data in logs | `audit_log`, security review 2026-10-21 | log retention at Vercel/Supabase unknown (see processors) |
| Encryption | HTTPS only (HSTS), provider disk encryption | response headers verified on the production domain 2026-10-21 | provider statements not collected |
| Segregation of duties / secrets | secrets only in the host environment; the browser never receives the secret key (bundle check in CI) | `check:bundle`, `check:env`, Gitleaks | rotation schedule |
| Backups and restore | provider daily backups; logical restore rehearsal | `scripts/drills/restore.sh` | point-in-time restore drill on the production project (B8) |
| Incident handling | runbook, severity classes, notification decision record | `docs/runbooks/incident.md` | named deputy, tested alert path (G-02, G-12) |
| Processors | list, regions and open contract steps | [processors-and-transfers.md](processors-and-transfers.md) | vendor data-processing terms accepted and dated (G-05) |
| Retention and deletion | 3-year customer rule, 14-day account deletion grace, purge jobs | [retention-deletion-matrix.md](retention-deletion-matrix.md), pgTAP 190/220 | none known |
| Periodic review | this file and the release gate report are re-run before each release | `docs/evidence/release-gate-report-2026-10-21.md` | a calendar date for the next review |
