# Strix local assessment — 2026-10-21

**Status: NOT RUN / NO CONFIRMED FINDINGS.** This document is a verified execution-readiness handoff, not a penetration-test result.

## Scope and branch
- Repository: `yotamfried-ux/Appointment-scheduling-system`.
- Isolated working branch: `security/strix-local-assessment-20261021`.
- Authorized target: local checkout and local Supabase only. Production, hosted Supabase, and third-party endpoints are excluded.
- Existing runner proposal: `.github/workflows/strix-local.yml` (manual `workflow_dispatch`).
- Prior findings: `docs/evidence/security-review-2026-10-21.md`; do not relabel these as newly discovered.
- Coverage mapping: Engineering-OS `docs/launch-readiness/twenty-checks.md`.

## Verified in this preparation session
- GitHub connector can read the repository and branch; workflow and `scripts/local-env.sh` contents were inspected.
- `package.json` provides `db:start`, `build`, and local Next.js startup capability.
- Security Agent and Engineering Run Orchestrator read `README.md` via dynamically selected GitHub MCP repository.
- This ChatGPT execution container does **not** have a Docker executable or Strix executable.
- No Strix runtime, local target, two-tenant fixtures, or model invocation was verified.

## Critical blockers / do not dispatch until resolved
1. **Model credential:** Strix needs a supported model/provider API accessible to the runner. An OpenRouter credential stored in n8n is **not automatically available** to a GitHub Actions job. Do not export or print secrets to make it work. Configure an authorized GitHub Actions secret or a purpose-built authenticated model gateway, then verify with a redacted preflight.
2. **Network boundary:** The workflow starts Next.js bound to `127.0.0.1:3100`. Strix runs its own Docker sandbox, whose loopback is not necessarily the GitHub runner host. Verify sandbox-to-target connectivity using an isolated host gateway or network; do not mistake runner-host `curl` success for sandbox reachability.
3. **Isolation enforcement:** Natural-language `--instruction` restrictions are not network controls. Ensure the sandbox has an enforceable outbound allowlist limited to the local target and dependencies, or run in a suitably isolated test environment; do not expose production credentials.
4. **Tenant coverage:** Seed two separate tenant owners/businesses and representative bookings using only local Supabase. Verify that tenant boundaries are real before claiming IDOR/RLS tests were performed.
5. **CLI/version:** Install from an authenticated or pinned release, inspect `strix --help` and `strix --version`, and verify actual CLI flags and output format before invoking a scan.
6. **Workflow dispatch:** Manual `workflow_dispatch` may require the workflow file to exist on the repository default branch to be discoverable. Keep this change isolated until a reviewed dispatch mechanism is available.
7. **Evidence:** Preserve raw Strix output, application and local DB versions, workflow run URL, redacted logs, and independent reproduction steps. A successful workflow run alone is not proof of tested security properties.

## Acceptance criteria
- [ ] Authorized runner and model credential are reachable without secret disclosure.
- [ ] Strix CLI/version and sandbox startup verified.
- [ ] Enforced local-only network policy verified.
- [ ] Local Tori and Supabase reachable **from inside** the Strix sandbox.
- [ ] Two isolated tenant fixtures created and validated.
- [ ] Bounded assessment executed against isolated target.
- [ ] Findings reproduced; raw evidence retained; report committed to this branch.
- [ ] Claude handoff distinguishes confirmed issues, prior issues, hypotheses, clean checks, and untested areas.

## Claude handoff
Do not modify application source during the scan. For every confirmed finding provide severity, source file and line or local endpoint, minimal reproduction, impact, proposed fix, and Engineering-OS check ID. Require separate review and regression verification for subsequent fixes.
