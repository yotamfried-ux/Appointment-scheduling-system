import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Mock db-ready
const mockDbReady = vi.fn();
vi.mock("@/platform/db-ready", () => ({
  databaseReady: () => mockDbReady(),
}));

// Mock job-health
const mockJobHealth = vi.fn();
vi.mock("@/modules/notifications/job-health", () => ({
  jobHealth: () => mockJobHealth(),
}));

// Mock systemDb
let mockJobRunsStore: Record<string, any> = {};
let mockDbWriteFailure = false;
const mockSystemDb = {
  from: (table: string) => {
    if (table !== "job_runs") throw new Error("Unexpected table: " + table);
    return {
      select: () => ({
        eq: (_col1: string, val1: string) => ({
          eq: (_col2: string, val2: string) => ({
            maybeSingle: async () => {
              const key = `${val1}:${val2}`;
              return { data: mockJobRunsStore[key] ?? null, error: null };
            },
          }),
        }),
      }),
      upsert: async (row: any) => {
        if (mockDbWriteFailure) {
          return { data: null, error: { message: "Disk full or connection aborted" } };
        }
        const key = `${row.job_name}:${row.run_key}`;
        mockJobRunsStore[key] = { ...row };
        return { data: row, error: null };
      },
    };
  },
  rpc: async () => ({ data: true, error: null }),
};

vi.mock("@/platform/system-db", () => ({
  systemDb: () => mockSystemDb,
}));

// Mock emailProvider
const sentEmails: any[] = [];
let mockEmailSendFailure = false;
let mockEmailErrorStatus: number | undefined = undefined;

vi.mock("@/modules/notifications/config", () => ({
  emailProvider: () => ({
    name: "fake",
    send: async (msg: any) => {
      if (mockEmailSendFailure) {
        const err: any = new Error("Resend rate limit exceeded (transient)");
        if (mockEmailErrorStatus) err.status = mockEmailErrorStatus;
        throw err;
      }
      sentEmails.push(msg);
      return { id: `msg_${Date.now()}` };
    },
  }),
  platformAdminEmail: () => "operator@turim.d2ryf.com",
}));

const { runProductionMonitor, resetMonitorStateForTesting } = await import("@/modules/notifications/monitor");
const { authorizeMonitoring } = await import("@/lib/security/cron");

describe("Vercel Production Monitor Hardened Quality & Security Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJobRunsStore = {};
    mockDbWriteFailure = false;
    sentEmails.length = 0;
    mockEmailSendFailure = false;
    mockEmailErrorStatus = undefined;
    resetMonitorStateForTesting();
    mockDbReady.mockResolvedValue(true);
    mockJobHealth.mockResolvedValue({
      ok: true,
      jobs: [
        { job: "outbox", lastOk: new Date().toISOString(), ageMinutes: 2, failed24h: 0, stale: false },
        { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
        { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
        { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
      ],
    });
  });

  describe("1-3. CRON_SECRET / MONITOR_SECRET Authorization Guardrails", () => {
    const dummySecret = "a".repeat(32);

    it("1. Rejects request without secrets configured or provided", () => {
      vi.stubEnv("CRON_SECRET", dummySecret);
      expect(() => authorizeMonitoring(new Request("http://x/api/jobs/monitor"))).toThrow();
    });

    it("2. Rejects request with wrong secret", () => {
      vi.stubEnv("CRON_SECRET", dummySecret);
      expect(() =>
        authorizeMonitoring(
          new Request("http://x/api/jobs/monitor", {
            headers: { authorization: "Bearer invalid-secret-value-12345" },
          })
        )
      ).toThrow();
    });

    it("3. Authorizes valid CRON_SECRET or MONITOR_SECRET bearer request", () => {
      vi.stubEnv("CRON_SECRET", dummySecret);
      expect(() =>
        authorizeMonitoring(
          new Request("http://x/api/jobs/monitor", {
            headers: { authorization: `Bearer ${dummySecret}` },
          })
        )
      ).not.toThrow();

      vi.stubEnv("MONITOR_SECRET", "m".repeat(32));
      expect(() =>
        authorizeMonitoring(
          new Request("http://x/api/jobs/monitor", {
            headers: { authorization: `Bearer ${"m".repeat(32)}` },
          })
        )
      ).not.toThrow();
    });
  });

  describe("4. All Probes Healthy & Enhanced Liveness", () => {
    it("reports healthy when app, database, and all cron jobs are operational", async () => {
      const res = await runProductionMonitor();
      expect(res.healthy).toBe(true);
      expect(res.checks.app.status).toBe("ok");
      expect(res.checks.app.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(res.checks.app.memoryUsageMb).toBeGreaterThan(0);
      expect(res.checks.database.status).toBe("ready");
      expect(res.checks.cron.status).toBe("healthy");
      expect(res.checks.storage.status).toBe("persisted");
      expect(res.incident.status).toBe("healthy");
      expect(res.incident.alertSent).toBe(false);
      expect(sentEmails.length).toBe(0);
    });
  });

  describe("5. Alert Delivery Failure, State Separation, and Automatic Retry", () => {
    it("does not mark alert as sent when Resend fails, and retries with identical payload on next run", async () => {
      // Simulate stale cron job (DB is UP so job_runs persists state)
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: new Date(Date.now() - 3600_000).toISOString(), ageMinutes: 60, failed24h: 3, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });
      mockEmailSendFailure = true;

      // Run 1: Failure detected, but Resend delivery fails
      const run1 = await runProductionMonitor();
      expect(run1.healthy).toBe(false);
      expect(run1.incident.status).toBe("triggered");
      expect(run1.incident.alertSent).toBe(false);
      expect(run1.incident.notificationStatus).toBe("pending_alert");
      expect(run1.incident.alertError).toBe("Resend rate limit exceeded (transient)");
      expect(sentEmails.length).toBe(0);

      // Verify DB stored state shows pending_alert and did not record lastAlertSentAt
      expect(mockJobRunsStore["monitor:incident_state"]).toBeDefined();
      const stored = JSON.parse(mockJobRunsStore["monitor:incident_state"].error);
      expect(stored.notificationStatus).toBe("pending_alert");
      expect(stored.lastAlertSentAt).toBeUndefined();
      expect(stored.attemptCount).toBe(1);

      // Run 2: 15 minutes later, still failing, but Resend is now recovered
      mockEmailSendFailure = false;
      const run2 = await runProductionMonitor();
      expect(run2.healthy).toBe(false);
      expect(run2.incident.status).toBe("ongoing");
      expect(run2.incident.alertRetrying).toBe(true);
      expect(run2.incident.alertSent).toBe(true);
      expect(run2.incident.notificationStatus).toBe("alert_sent");
      expect(sentEmails.length).toBe(1);
      expect(sentEmails[0].attempt).toBe(2);

      // Verify the retry used the EXACT SAME idempotency key and timestamp as recorded in run 1
      expect(sentEmails[0].idempotencyKey).toBe(stored.stableIdempotencyKey);
      expect(sentEmails[0].text).toContain(stored.firstDetectedAt);

      // Run 3: 30 minutes later, still failing -> Should DEDUPLICATE (no duplicate email)
      const run3 = await runProductionMonitor();
      expect(run3.healthy).toBe(false);
      expect(run3.incident.status).toBe("ongoing");
      expect(run3.incident.alertSent).toBe(false);
      expect(sentEmails.length).toBe(1); // Still exactly 1
    });

    it("caps retry attempts when Resend fails permanently to prevent infinite loops", async () => {
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: new Date(Date.now() - 3600_000).toISOString(), ageMinutes: 60, failed24h: 3, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });
      mockEmailSendFailure = true;

      // Run 1 to 5: all fail sending
      for (let i = 1; i <= 5; i++) {
        await runProductionMonitor();
      }

      // Run 6: Max retries exceeded
      const run6 = await runProductionMonitor();
      expect(run6.incident.alertSent).toBe(false);
      expect(run6.incident.alertError).toContain("Max alert retries (5) reached");
    });
  });

  describe("6. Resend Idempotency & 409 Conflict Handling", () => {
    it("handles Resend 409 conflict gracefully as successful idempotent delivery", async () => {
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: null, ageMinutes: null, failed24h: 1, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });
      mockEmailSendFailure = true;
      mockEmailErrorStatus = 409;

      const res = await runProductionMonitor();
      expect(res.healthy).toBe(false);
      expect(res.incident.alertSent).toBe(true);
      expect(res.incident.alertError).toBeUndefined();
    });
  });

  describe("7. Recovery Notification Failure and Safe Retry", () => {
    it("does not clear recovery state prematurely if recovery email delivery fails", async () => {
      // 1. Initial failure (cron failure, DB up)
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: null, ageMinutes: null, failed24h: 1, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });
      await runProductionMonitor();
      expect(sentEmails.length).toBe(1);

      // 2. System recovers, but sending recovery email fails (e.g. transient 500)
      mockJobHealth.mockResolvedValue({
        ok: true,
        jobs: [
          { job: "outbox", lastOk: new Date().toISOString(), ageMinutes: 2, failed24h: 0, stale: false },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });
      mockEmailSendFailure = true;
      const recoveryRun1 = await runProductionMonitor();
      expect(recoveryRun1.healthy).toBe(true);
      expect(recoveryRun1.incident.status).toBe("recovered");
      expect(recoveryRun1.incident.alertSent).toBe(false);
      expect(recoveryRun1.incident.notificationStatus).toBe("pending_recovery");
      expect(sentEmails.length).toBe(1); // No new email yet

      // Verify stored state in DB preserves pending_recovery
      const stored = JSON.parse(mockJobRunsStore["monitor:incident_state"].error);
      expect(stored.notificationStatus).toBe("pending_recovery");

      // 3. Next run, recovery email succeeds
      mockEmailSendFailure = false;
      const recoveryRun2 = await runProductionMonitor();
      expect(recoveryRun2.healthy).toBe(true);
      expect(recoveryRun2.incident.status).toBe("recovered");
      expect(recoveryRun2.incident.alertSent).toBe(true);
      expect(recoveryRun2.incident.notificationStatus).toBe("idle");
      expect(sentEmails.length).toBe(2);
      expect(sentEmails[1].subject).toContain("[RESOLVED]");

      // 4. Subsequent run: stays healthy with zero additional emails
      const steadyRun = await runProductionMonitor();
      expect(steadyRun.healthy).toBe(true);
      expect(steadyRun.incident.status).toBe("healthy");
      expect(sentEmails.length).toBe(2);
    });
  });

  describe("8. Complete Simulation Isolation from Production State", () => {
    it("guarantees simulation does not overwrite or resolve real Production incident state", async () => {
      // Step 1: Real Production incident occurs (cron failure, DB up)
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: null, ageMinutes: null, failed24h: 1, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });
      const realRun = await runProductionMonitor();
      expect(realRun.healthy).toBe(false);
      expect(realRun.incident.status).toBe("triggered");
      expect(mockJobRunsStore["monitor:incident_state"]).toBeDefined();

      const realStoredState = JSON.parse(mockJobRunsStore["monitor:incident_state"].error);
      expect(realStoredState.isIncident).toBe(true);
      expect(realStoredState.components).toEqual(["cron:outbox"]);

      // Step 2: Operator triggers a simulation drill with simulate: "database"
      const simRun = await runProductionMonitor({ simulate: "database" });
      expect(simRun.isSimulation).toBe(true);
      expect(simRun.incident.isSimulation).toBe(true);
      expect(simRun.incident.failingComponents).toContain("database");

      // Verify that simulation used 'simulation_state' in job_runs
      expect(mockJobRunsStore["monitor:simulation_state"]).toBeDefined();
      const simStoredState = JSON.parse(mockJobRunsStore["monitor:simulation_state"].error);
      expect(simStoredState.components).toContain("database");

      // Verify that real Production incident state was COMPLETELY UNTOUCHED!
      const afterSimRealState = JSON.parse(mockJobRunsStore["monitor:incident_state"].error);
      expect(afterSimRealState.isIncident).toBe(true);
      expect(afterSimRealState.components).toEqual(["cron:outbox"]);
      expect(afterSimRealState.firstDetectedAt).toBe(realStoredState.firstDetectedAt);

      // Verify that simulated alert email is clearly tagged with [TEST SIMULATION]
      const simEmail = sentEmails.find((e) => e.subject.includes("[TEST SIMULATION]"));
      expect(simEmail).toBeDefined();
      expect(simEmail.subject).toContain("[TEST SIMULATION]");
      expect(simEmail.text).toContain("THIS IS A SAFE OPERATOR DRILL");
    });
  });

  describe("9. DB Outage Fail-Safe (Stateless / Provider Deduplication)", () => {
    it("delivers alert during complete database outage without relying on shared process memory", async () => {
      mockDbReady.mockResolvedValue(false);

      // Run on fresh cold-start instance 1
      resetMonitorStateForTesting();
      const run1 = await runProductionMonitor();
      expect(run1.healthy).toBe(false);
      expect(run1.checks.database.status).toBe("unavailable");
      expect(run1.checks.storage.status).toBe("transient_db_down");
      expect(run1.incident.alertSent).toBe(true);
      expect(sentEmails.length).toBe(1);

      // Cold start instance 2 (memory completely cleared)
      resetMonitorStateForTesting();
      const run2 = await runProductionMonitor();
      expect(run2.healthy).toBe(false);
      // Both runs generated the exact same deterministic idempotency key for the current window
      expect(sentEmails.length).toBe(2);
      expect(sentEmails[0].idempotencyKey).toBe(sentEmails[1].idempotencyKey);
      expect(sentEmails[0].text).toBe(sentEmails[1].text);
      // Resend will deduplicate on provider side because key + payload are identical!
    });
  });

  describe("10. Database Persistence Failure Reporting", () => {
    it("reports persistence_failed when writing incident state to job_runs fails while DB is up", async () => {
      // Cron failure triggers persistIncidentState, but DB upsert encounters write error
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: null, ageMinutes: null, failed24h: 1, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });
      mockDbWriteFailure = true;

      const res = await runProductionMonitor();
      expect(res.checks.storage.status).toBe("persistence_failed");
      expect(res.checks.storage.error).toContain("Disk full");
    });
  });

  describe("11. Material Change in Failing Components", () => {
    it("sends an updated alert when additional components fail during an ongoing incident", async () => {
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: null, ageMinutes: null, failed24h: 1, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });
      await runProductionMonitor();
      expect(sentEmails.length).toBe(1);
      expect(sentEmails[0].subject).toContain("cron:outbox");

      // Add second cron failure (waitlist)
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: null, ageMinutes: null, failed24h: 1, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: null, ageMinutes: null, failed24h: 1, stale: true },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });
      await runProductionMonitor();
      expect(sentEmails.length).toBe(2);
      expect(sentEmails[1].subject).toContain("cron:outbox, cron:waitlist");
    });
  });

  describe("12. Zero Leakage of Secrets or Customer PII", () => {
    it("does not leak secrets, bearer tokens, or PII in monitor output", async () => {
      const res = await runProductionMonitor();
      const serialized = JSON.stringify(res);
      expect(serialized).not.toContain("sb_secret");
      expect(serialized).not.toContain("CRON_SECRET");
      expect(serialized).not.toContain("MONITOR_SECRET");
      expect(serialized).not.toContain("Bearer");
      expect(serialized).not.toContain("customer");
      expect(serialized).not.toContain("booking");
    });
  });
});
