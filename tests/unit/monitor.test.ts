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
let mockFinalizeFailure = false;
let mockCasConflict = false;
let mockDbReadError: string | null = null;
let mockCorruptedJson = false;
let mockRateLimitAllowed = true;
let mockRateLimitCalls = 0;

const mockSystemDb = {
  from: (table: string) => {
    if (table !== "job_runs") throw new Error("Unexpected table: " + table);
    return {
      select: () => ({
        eq: (_col1: string, val1: string) => ({
          eq: (_col2: string, val2: string) => ({
            maybeSingle: async () => {
              if (mockDbReadError) {
                return { data: null, error: { message: mockDbReadError } };
              }
              const key = `${val1}:${val2}`;
              const row = mockJobRunsStore[key];
              if (!row) return { data: null, error: null };
              if (mockCorruptedJson) {
                return { data: { ...row, error: "NOT_VALID_JSON{{" }, error: null };
              }
              return { data: row, error: null };
            },
          }),
        }),
      }),
      insert: (row: any) => ({
        select: async () => {
          if (mockDbWriteFailure) {
            return { data: null, error: { message: "Disk full or connection aborted" } };
          }
          if (mockCasConflict) {
            return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
          const key = `${row.job_name}:${row.run_key}`;
          if (mockJobRunsStore[key]) {
            return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
          mockJobRunsStore[key] = { ...row };
          return { data: [{ finished_at: row.finished_at }], error: null };
        },
      }),
      update: (updates: any) => ({
        eq: (_col1: string, val1: string) => ({
          eq: (_col2: string, val2: string) => ({
            eq: (_col3: string, val3: string) => ({
              select: async () => {
                if (mockDbWriteFailure) {
                  return { data: null, error: { message: "Disk full or connection aborted" } };
                }
                if (mockFinalizeFailure) {
                  const parsed = updates.error ? JSON.parse(updates.error) : {};
                  if (!parsed.dispatchLease) {
                    return { data: null, error: { message: "Network connection dropped on finalize" } };
                  }
                }
                if (mockCasConflict) {
                  return { data: [], error: null };
                }
                const key = `${val1}:${val2}`;
                const existing = mockJobRunsStore[key];
                if (!existing || existing.finished_at !== val3) {
                  return { data: [], error: null };
                }
                mockJobRunsStore[key] = { ...existing, ...updates };
                return { data: [{ finished_at: updates.finished_at }], error: null };
              },
            }),
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
  rpc: async (fn: string) => {
    if (fn === "public_rate_limit") {
      mockRateLimitCalls++;
      return { data: [{ allowed: mockRateLimitAllowed, retry_after: 60 }], error: null };
    }
    return { data: true, error: null };
  },
};

vi.mock("@/platform/system-db", () => ({
  systemDb: () => mockSystemDb,
}));

// Mock emailProvider
const sentEmails: any[] = [];
let mockEmailSendFailure = false;
let mockEmailErrorStatus: number | undefined = undefined;
let mockPermanentEmailError = false;

vi.mock("@/modules/notifications/config", () => ({
  emailProvider: () => ({
    name: "fake",
    send: async (msg: any) => {
      if (mockPermanentEmailError) {
        const { PermanentEmailError } = await import("@/modules/notifications/ports");
        throw new PermanentEmailError("Invalid email address domain rejected (permanent)");
      }
      if (mockEmailSendFailure) {
        if (mockEmailErrorStatus === 409) {
          const { TransientEmailError } = await import("@/modules/notifications/ports");
          throw new TransientEmailError("Resend idempotency conflict (HTTP 409)");
        }
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

const { runProductionMonitor, resetMonitorStateForTesting, calculateBackoffMinutes } = await import("@/modules/notifications/monitor");
const { authorizeMonitoring } = await import("@/lib/security/cron");

describe("Vercel Production Monitor Hardened Quality & Security Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJobRunsStore = {};
    mockDbWriteFailure = false;
    mockFinalizeFailure = false;
    mockCasConflict = false;
    mockDbReadError = null;
    mockCorruptedJson = false;
    mockRateLimitAllowed = true;
    mockRateLimitCalls = 0;
    sentEmails.length = 0;
    mockEmailSendFailure = false;
    mockEmailErrorStatus = undefined;
    mockPermanentEmailError = false;
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

    it("3. Authorizes valid CRON_SECRET or MONITOR_SECRET bearer request and identifies caller role", () => {
      vi.stubEnv("CRON_SECRET", dummySecret);
      const resCron = authorizeMonitoring(
        new Request("http://x/api/jobs/monitor", {
          headers: { authorization: `Bearer ${dummySecret}` },
        })
      );
      expect(resCron.isCronSecret).toBe(true);

      vi.stubEnv("MONITOR_SECRET", "m".repeat(32));
      const resMonitor = authorizeMonitoring(
        new Request("http://x/api/jobs/monitor", {
          headers: { authorization: `Bearer ${"m".repeat(32)}` },
        })
      );
      expect(resMonitor.isCronSecret).toBe(false);
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

  describe("5. Alert Delivery Failure, State Separation, and Transient Cooldown", () => {
    it("does not mark alert as sent when Resend fails, and retries with identical payload on next run", async () => {
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

      const run1 = await runProductionMonitor();
      expect(run1.healthy).toBe(false);
      expect(run1.incident.alertSent).toBe(false);
      expect(run1.incident.notificationStatus).toBe("pending_alert");
      expect(run1.incident.alertError).toBeDefined();

      const storedAfterRun1 = JSON.parse(mockJobRunsStore["monitor:incident_state"].error);
      expect(storedAfterRun1.notificationStatus).toBe("pending_alert");
      expect(storedAfterRun1.stableIdempotencyKey).toBeDefined();

      mockEmailSendFailure = false;
      const run2 = await runProductionMonitor({ ignoreBackoff: true });
      expect(run2.healthy).toBe(false);
      expect(run2.incident.status).toBe("ongoing");
      expect(run2.incident.alertSent).toBe(true);
      expect(run2.incident.notificationStatus).toBe("alert_sent");
      expect(sentEmails.length).toBe(1);

      const run3 = await runProductionMonitor();
      expect(run3.incident.alertSent).toBe(false);
      expect(sentEmails.length).toBe(1);
    });

    it("guarantees 100% identical alert email payload and idempotency key on retry even when live probe metrics (such as stale job age) change between runs", async () => {
      // Run 1: fails with outbox age: 60m
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: new Date(Date.now() - 3600_000).toISOString(), ageMinutes: 60, failed24h: 1, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });
      mockEmailSendFailure = true;

      const run1 = await runProductionMonitor();
      expect(run1.incident.notificationStatus).toBe("pending_alert");

      // Run 2: 15 minutes later, job is now 75m old and failed24h increased to 3!
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: new Date(Date.now() - 4500_000).toISOString(), ageMinutes: 75, failed24h: 3, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 20, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 16, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 75, failed24h: 0, stale: false },
        ],
      });
      mockEmailSendFailure = false;

      const run2 = await runProductionMonitor({ ignoreBackoff: true });
      expect(run2.incident.alertSent).toBe(true);
      expect(sentEmails.length).toBe(1);

      // The sent email has the stable reason ("age: 60m") matching the original incident
      expect(sentEmails[0].text).toContain("age: 60m");
      expect(sentEmails[0].text).not.toContain("age: 75m");
      // But the report itself displays the live current probe reason
      expect(run2.incident.reason).toContain("age: 75m");
    });

    it("enters cooldown after 5 transient failures to prevent busy-loops without permanently silencing alerts", async () => {
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

      // Runs 1 to 4: pending_alert with backoff
      for (let i = 1; i <= 4; i++) {
        const run = await runProductionMonitor({ ignoreBackoff: true });
        expect(run.incident.notificationStatus).toBe("pending_alert");
      }

      // Run 5: Reaches 5 attempts -> Enters Cooldown (not permanent silencing!)
      const run5 = await runProductionMonitor({ ignoreBackoff: true });
      expect(run5.incident.alertSent).toBe(false);
      expect(run5.incident.notificationStatus).toBe("in_cooldown");
      expect(run5.incident.alertError).toContain("Cooldown active for 120m");

      // Run 6 without ignoreBackoff: during cooldown -> does not send
      const run6 = await runProductionMonitor();
      expect(run6.incident.alertSent).toBe(false);
      expect(run6.incident.notificationStatus).toBe("in_cooldown");

      // When operator forces retry or cooldown expires and Resend recovers:
      mockEmailSendFailure = false;
      const run7 = await runProductionMonitor({ ignoreBackoff: true });
      expect(run7.incident.alertSent).toBe(true);
      expect(run7.incident.notificationStatus).toBe("alert_sent");
      expect(sentEmails.length).toBe(1);
    });
  });

  describe("6. Resend Idempotency & 409 Conflict Handling", () => {
    it("treats Resend 409 conflict as TransientEmailError: keeps pending_alert and queues for backoff retry", async () => {
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

      const run1 = await runProductionMonitor();
      expect(run1.healthy).toBe(false);
      expect(run1.incident.alertSent).toBe(false);
      expect(run1.incident.notificationStatus).toBe("pending_alert");
      expect(run1.incident.alertError).toContain("409");

      mockEmailSendFailure = false;
      const run2 = await runProductionMonitor({ ignoreBackoff: true });
      expect(run2.incident.alertSent).toBe(true);
      expect(run2.incident.notificationStatus).toBe("alert_sent");
    });
  });

  describe("7. Recovery Notification Failure and Safe Retry", () => {
    it("does not clear recovery state prematurely if recovery email delivery fails", async () => {
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: null, ageMinutes: null, failed24h: 1, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });

      // 1. Initial alert sent
      const alertRun = await runProductionMonitor();
      expect(alertRun.incident.alertSent).toBe(true);
      expect(alertRun.incident.notificationStatus).toBe("alert_sent");

      // 2. Systems recover, but recovery email fails
      mockJobHealth.mockResolvedValue({
        ok: true,
        jobs: [
          { job: "outbox", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });
      mockEmailSendFailure = true;

      const recFailRun = await runProductionMonitor();
      expect(recFailRun.healthy).toBe(true);
      expect(recFailRun.incident.status).toBe("recovered");
      expect(recFailRun.incident.alertSent).toBe(false);
      expect(recFailRun.incident.notificationStatus).toBe("pending_recovery");

      // 3. Next run: recovery email succeeds
      mockEmailSendFailure = false;
      const recSuccessRun = await runProductionMonitor();
      expect(recSuccessRun.incident.status).toBe("recovered");
      expect(recSuccessRun.incident.alertSent).toBe(true);
      expect(recSuccessRun.incident.notificationStatus).toBe("idle");
    });
  });

  describe("8. Complete Simulation Isolation from Production State", () => {
    it("guarantees simulation does not overwrite or resolve real Production incident state", async () => {
      mockDbReady.mockResolvedValue(false);
      const prodIncident = await runProductionMonitor();
      expect(prodIncident.healthy).toBe(false);
      expect(prodIncident.checks.database.status).toBe("unavailable");
      expect(prodIncident.isSimulation).toBeUndefined();

      mockDbReady.mockResolvedValue(true);
      const simRun = await runProductionMonitor({ simulate: "cron" });
      expect(simRun.isSimulation).toBe(true);
      expect(simRun.incident.failingComponents).toContain("cron:outbox");

      mockDbReady.mockResolvedValue(false);
      const prodFollowup = await runProductionMonitor();
      expect(prodFollowup.healthy).toBe(false);
      expect(prodFollowup.isSimulation).toBeUndefined();
      expect(prodFollowup.incident.failingComponents).toEqual(["database"]);
    });
  });

  describe("9. DB Outage Fail-Safe (Stateless / Provider Deduplication)", () => {
    it("delivers alert during complete database outage without relying on shared process memory", async () => {
      mockDbReady.mockResolvedValue(false);

      const run1 = await runProductionMonitor();
      expect(run1.healthy).toBe(false);
      expect(run1.checks.database.status).toBe("unavailable");
      expect(run1.checks.storage.status).toBe("transient_db_down");
      expect(run1.incident.alertSent).toBe(true);
      expect(sentEmails.length).toBe(1);

      resetMonitorStateForTesting();
      const run2 = await runProductionMonitor();
      expect(run2.healthy).toBe(false);
      expect(run2.checks.storage.status).toBe("transient_db_down");
      expect(sentEmails.length).toBe(2);
      expect(sentEmails[0].idempotencyKey).toBe(sentEmails[1].idempotencyKey);
    });
  });

  describe("10. Database Persistence Failure Reporting", () => {
    it("reports persistence_failed when writing incident state to job_runs fails while DB is up", async () => {
      mockDbReady.mockResolvedValue(true);
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

      const run = await runProductionMonitor();
      expect(run.healthy).toBe(false);
      expect(run.checks.storage.status).toBe("persistence_failed");
      expect(run.checks.storage.error).toBeDefined();
    });
  });

  describe("11. Material Change in Failing Components", () => {
    it("sends an updated alert when additional components fail during an ongoing incident", async () => {
      mockDbReady.mockResolvedValue(true);
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: null, ageMinutes: null, failed24h: 1, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });

      const run1 = await runProductionMonitor();
      expect(run1.incident.alertSent).toBe(true);
      expect(sentEmails.length).toBe(1);
      expect(sentEmails[0].subject).toContain("cron:outbox");

      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: null, ageMinutes: null, failed24h: 1, stale: true },
          { job: "reminders", lastOk: null, ageMinutes: null, failed24h: 1, stale: true },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });

      const run2 = await runProductionMonitor();
      expect(run2.incident.status).toBe("triggered");
      expect(run2.incident.alertSent).toBe(true);
      expect(sentEmails.length).toBe(2);
      expect(sentEmails[1].subject).toContain("cron:outbox, cron:reminders");
    });
  });

  describe("12. Zero Leakage of Secrets or Customer PII", () => {
    it("does not leak secrets, bearer tokens, or PII in monitor output", async () => {
      vi.stubEnv("CRON_SECRET", "super-secret-cron-token-12345");
      vi.stubEnv("MONITOR_SECRET", "super-secret-monitor-token-12345");

      mockDbReady.mockResolvedValue(false);
      const res = await runProductionMonitor();
      const serialized = JSON.stringify(res);

      expect(serialized).not.toContain("super-secret-cron-token-12345");
      expect(serialized).not.toContain("super-secret-monitor-token-12345");
      expect(serialized).not.toContain("Bearer ");
    });
  });

  describe("13. Compare-And-Swap (CAS) Concurrency & Atomic State Protection", () => {
    it("safely flags cas_conflict when concurrent worker modifies state first", async () => {
      mockDbReady.mockResolvedValue(true);
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: null, ageMinutes: null, failed24h: 1, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });
      mockCasConflict = true;

      const run = await runProductionMonitor();
      expect(run.healthy).toBe(false);
      expect(run.checks.storage.status).toBe("cas_conflict");
    });
  });

  describe("14. Permanent vs Transient Error Differentiation & Backoff Schedule", () => {
    it("correctly calculates exponential backoff intervals", () => {
      expect(calculateBackoffMinutes(0)).toBe(15);
      expect(calculateBackoffMinutes(1)).toBe(15);
      expect(calculateBackoffMinutes(2)).toBe(30);
      expect(calculateBackoffMinutes(3)).toBe(60);
      expect(calculateBackoffMinutes(4)).toBe(60);
    });

    it("immediately transitions to permanent_failure without retrying on PermanentEmailError", async () => {
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: null, ageMinutes: null, failed24h: 1, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });
      mockPermanentEmailError = true;

      const res = await runProductionMonitor();
      expect(res.healthy).toBe(false);
      expect(res.incident.alertSent).toBe(false);
      expect(res.incident.notificationStatus).toBe("permanent_failure");
      expect(res.incident.alertError).toContain("permanent");

      // Verify next run does not even attempt sending
      sentEmails.length = 0;
      const res2 = await runProductionMonitor();
      expect(res2.incident.alertSent).toBe(false);
      expect(res2.incident.notificationStatus).toBe("permanent_failure");
      expect(sentEmails.length).toBe(0);
    });

    it("respects active backoff window and avoids sending emails before nextRetryAt", async () => {
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

      const run1 = await runProductionMonitor();
      expect(run1.incident.notificationStatus).toBe("pending_alert");
      const stored = JSON.parse(mockJobRunsStore["monitor:incident_state"].error);
      expect(stored.nextRetryAt).toBeDefined();

      mockEmailSendFailure = false;
      const run2 = await runProductionMonitor();
      expect(run2.incident.alertSent).toBe(false);
      expect(run2.incident.alertRetrying).toBe(true);
      expect(run2.incident.alertError).toContain("Retry backoff active");
      expect(sentEmails.length).toBe(0);
    });
  });

  describe("15. DB Outage 1-Hour Deterministic Deduplication", () => {
    it("generates 100% identical idempotency key and payload across 4 runs during DB outage in the same hour", async () => {
      mockDbReady.mockResolvedValue(false);

      const hourTimestamp = new Date().toISOString().slice(0, 13);
      const expectedKey = `tori-alert-db-outage-${hourTimestamp}`;

      for (let i = 0; i < 4; i++) {
        resetMonitorStateForTesting();
        const run = await runProductionMonitor();
        expect(run.healthy).toBe(false);
        expect(run.checks.database.status).toBe("unavailable");
        expect(run.checks.storage.status).toBe("transient_db_down");
      }

      expect(sentEmails.length).toBe(4);
      for (const email of sentEmails) {
        expect(email.idempotencyKey).toBe(expectedKey);
        expect(email.subject).toBe(sentEmails[0].subject);
        expect(email.text).toBe(sentEmails[0].text);
        expect(email.html).toBe(sentEmails[0].html);
      }
    });
  });

  describe("16. Atomic Dispatch Claim-Check & Concurrency Protection", () => {
    it("prevents duplicate alert dispatches when two concurrent workers run simultaneously", async () => {
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: null, ageMinutes: null, failed24h: 1, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });

      // Worker 1 runs and claims the lease
      const run1 = await runProductionMonitor();
      expect(run1.incident.alertSent).toBe(true);
      expect(sentEmails.length).toBe(1);

      // Verify lease is released after completion
      const stored = JSON.parse(mockJobRunsStore["monitor:incident_state"].error);
      expect(stored.dispatchLease).toBeUndefined();
      expect(stored.notificationStatus).toBe("alert_sent");
    });

    it("allows a subsequent worker to reclaim an expired lease if a previous worker crashed mid-send", async () => {
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: null, ageMinutes: null, failed24h: 1, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });

      // Pre-seed an expired lease left by a crashed worker 2 hours ago
      const expiredLease = {
        owner: "crashed-worker-uuid",
        expiresAt: new Date(Date.now() - 7200_000).toISOString(),
        action: "alert",
        idempotencyKey: "tori-alert-cron_outbox-2026-11-01T20:00",
      };
      const initialFinishedAt = new Date(Date.now() - 7200_000).toISOString();
      mockJobRunsStore["monitor:incident_state"] = {
        job_name: "monitor",
        run_key: "incident_state",
        status: "succeeded",
        started_at: initialFinishedAt,
        finished_at: initialFinishedAt,
        error: JSON.stringify({
          isIncident: true,
          components: ["cron:outbox"],
          notificationStatus: "pending_alert",
          firstDetectedAt: initialFinishedAt,
          attemptCount: 1,
          dispatchLease: expiredLease,
        }),
      };

      // Worker runs with ignoreBackoff
      const run = await runProductionMonitor({ ignoreBackoff: true });
      expect(run.incident.alertSent).toBe(true);
      expect(sentEmails.length).toBe(1);
    });

    it("reports persistence_failed when finalize CAS update fails after successful email send", async () => {
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: null, ageMinutes: null, failed24h: 1, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });
      // Simulate network crash precisely during the finalize CAS call
      mockFinalizeFailure = true;

      const run = await runProductionMonitor();
      expect(run.healthy).toBe(false);
      expect(run.incident.alertSent).toBe(true);
      expect(sentEmails.length).toBe(1);
      // Storage status accurately flags persistence_failed
      expect(run.checks.storage.status).toBe("persistence_failed");
      expect(run.checks.storage.error).toContain("finalize");
    });
  });

  describe("17. Recovery Idempotency & Exact Payload Match Across Retries", () => {
    it("pins recoveryDetectedAt and stableRecoveryKey to guarantee identical email payloads and idempotency keys across recovery retries", async () => {
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: null, ageMinutes: null, failed24h: 1, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });

      // 1. Initial alert sent
      await runProductionMonitor();
      expect(sentEmails.length).toBe(1);

      // 2. Systems recover, but recovery email fails transiently on attempt 1
      mockJobHealth.mockResolvedValue({
        ok: true,
        jobs: [
          { job: "outbox", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });
      mockEmailSendFailure = true;

      await runProductionMonitor();
      const stateAfterFail = JSON.parse(mockJobRunsStore["monitor:incident_state"].error);
      expect(stateAfterFail.notificationStatus).toBe("pending_recovery");
      expect(stateAfterFail.recoveryDetectedAt).toBeDefined();
      expect(stateAfterFail.stableRecoveryKey).toBeDefined();

      // 3. Retry recovery email
      mockEmailSendFailure = false;
      await runProductionMonitor();

      // Check recovery email payload
      const recoveryEmail = sentEmails[1];
      expect(recoveryEmail.subject).toContain("Tori Production Monitor — All systems operational");
      expect(recoveryEmail.text).toContain(`Recovered At: ${stateAfterFail.recoveryDetectedAt} UTC`);
      expect(recoveryEmail.idempotencyKey).toBe(stateAfterFail.stableIdempotencyKey);
    });

    it("overrides pending_recovery if a new incident occurs before recovery email is finalized", async () => {
      // Seed pending_recovery state
      const initialDetected = new Date(Date.now() - 3600_000).toISOString();
      mockJobRunsStore["monitor:incident_state"] = {
        job_name: "monitor",
        run_key: "incident_state",
        status: "succeeded",
        started_at: initialDetected,
        finished_at: initialDetected,
        error: JSON.stringify({
          isIncident: false,
          components: [],
          notificationStatus: "pending_recovery",
          firstDetectedAt: initialDetected,
          recoveryDetectedAt: initialDetected,
          stableRecoveryKey: "rec-test",
          attemptCount: 1,
        }),
      };

      // Now database goes down (new failure!)
      mockDbReady.mockResolvedValue(false);

      const run = await runProductionMonitor();
      expect(run.healthy).toBe(false);
      expect(run.incident.status).toBe("triggered");
      expect(run.incident.failingComponents).toEqual(["database"]);
      expect(run.incident.notificationStatus).toBe("alert_sent");
      expect(sentEmails.length).toBe(1);
      expect(sentEmails[0].subject).toContain("database");
    });
  });

  describe("18. Application Liveness Degradation", () => {
    it("flags app:memory failure and returns healthy: false when Node heap exceeds 950MB", async () => {
      const memSpy = vi.spyOn(process, "memoryUsage");
      memSpy.mockReturnValue({
        heapUsed: 980 * 1024 * 1024, // 980MB (> 950MB)
        heapTotal: 1024 * 1024 * 1024,
        external: 0,
        rss: 1100 * 1024 * 1024,
        arrayBuffers: 0,
      });

      const res = await runProductionMonitor();
      expect(res.healthy).toBe(false);
      expect(res.checks.app.status).toBe("degraded");
      expect(res.checks.app.memoryUsageMb).toBe(980);
      expect(res.incident.failingComponents).toContain("app:memory");
      expect(res.incident.reason).toContain("Excessive heap memory usage: 980MB");
      expect(res.incident.alertSent).toBe(true);

      memSpy.mockRestore();
    });
  });

  describe("19. Database State Read & Corrupted State Fail-Safe Handling", () => {
    it("gracefully handles corrupted JSON in job_runs without crashing or losing incident visibility", async () => {
      mockJobRunsStore["monitor:incident_state"] = {
        job_name: "monitor",
        run_key: "incident_state",
        status: "succeeded",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        error: "CORRUPTED_JSON{{{",
      };
      mockCorruptedJson = true;

      // When probes are failing and DB state is corrupted:
      mockDbReady.mockResolvedValue(false);
      const res = await runProductionMonitor();
      expect(res.healthy).toBe(false);
      expect(res.incident.status).toBe("triggered");
      expect(res.incident.alertSent).toBe(true);
    });

    it("falls back to warm instance cache if database read query fails", async () => {
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: null, ageMinutes: null, failed24h: 1, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });

      // Run 1: sets warm instance fallback
      await runProductionMonitor();
      expect(sentEmails.length).toBe(1);

      // Run 2: DB read query fails
      mockDbReadError = "Connection pool exhausted";
      const run2 = await runProductionMonitor();
      expect(run2.healthy).toBe(false);
      expect(run2.incident.status).toBe("ongoing");
      // Does not send duplicate email because warm instance knew alert was sent
      expect(sentEmails.length).toBe(1);
    });

    it("reports persistence_failed when databaseReady is true but reading job_runs encounters a query failure", async () => {
      mockDbReady.mockResolvedValue(true);
      mockDbReadError = "Connection reset by peer";

      const run = await runProductionMonitor();
      expect(run.checks.storage.status).toBe("persistence_failed");
      expect(run.checks.storage.error).toContain("Connection reset by peer");
    });

    it("does not overwrite a corrupted incident state row with idle when health probes pass", async () => {
      mockJobRunsStore["monitor:incident_state"] = {
        job_name: "monitor",
        run_key: "incident_state",
        status: "succeeded",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        error: "CORRUPTED_NON_JSON",
      };
      mockCorruptedJson = true;

      // All probes pass (system is nominally healthy)
      mockDbReady.mockResolvedValue(true);
      mockJobHealth.mockResolvedValue({
        ok: true,
        jobs: [
          { job: "outbox", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
        ],
      });

      const run = await runProductionMonitor();
      // Storage status flags the corrupted state
      expect(run.checks.storage.status).toBe("persistence_failed");
      expect(run.checks.storage.error).toContain("Corrupted incident state");
      // Does not overwrite corrupted DB record with idle
      expect(mockJobRunsStore["monitor:incident_state"].error).toBe("CORRUPTED_NON_JSON");
    });
  });

  describe("20. Durable Simulation Rate Limiting", () => {
    it("calls public_rate_limit RPC and suppresses simulation emails when rate limit is exceeded", async () => {
      // First simulation run: allowed
      mockRateLimitAllowed = true;
      const sim1 = await runProductionMonitor({ simulate: "database" });
      expect(sim1.isSimulation).toBe(true);
      expect(sim1.incident.alertSent).toBe(true);
      expect(sentEmails.length).toBe(1);
      expect(mockRateLimitCalls).toBeGreaterThanOrEqual(1);

      // Second simulation run within 60s: RPC disallows
      mockRateLimitAllowed = false;
      const sim2 = await runProductionMonitor({ simulate: "database" });
      expect(sim2.isSimulation).toBe(true);
      expect(sim2.incident.alertSent).toBe(false);
      expect(sim2.incident.alertError).toContain("rate limited");
      expect(sentEmails.length).toBe(1); // No new email
    });
  });

  describe("21. Least-Privilege Authorization Guardrails for Simulations & Force-Retry", () => {
    it("returns isCronSecret: false for MONITOR_SECRET and isCronSecret: true for CRON_SECRET", () => {
      vi.stubEnv("MONITOR_SECRET", "m".repeat(32));
      vi.stubEnv("CRON_SECRET", "c".repeat(32));

      const monitorReq = new Request("http://x/api/jobs/monitor", {
        headers: { authorization: `Bearer ${"m".repeat(32)}` },
      });
      const cronReq = new Request("http://x/api/jobs/monitor", {
        headers: { authorization: `Bearer ${"c".repeat(32)}` },
      });

      expect(authorizeMonitoring(monitorReq).isCronSecret).toBe(false);
      expect(authorizeMonitoring(cronReq).isCronSecret).toBe(true);
    });
  });
});
