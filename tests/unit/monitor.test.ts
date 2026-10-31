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
vi.mock("@/modules/notifications/config", () => ({
  emailProvider: () => ({
    name: "fake",
    send: async (msg: any) => {
      if (mockEmailSendFailure) {
        throw new Error("Resend rate limit exceeded (transient)");
      }
      sentEmails.push(msg);
      return { id: `msg_${Date.now()}` };
    },
  }),
  platformAdminEmail: () => "operator@turim.d2ryf.com",
}));

const { runProductionMonitor, resetMonitorStateForTesting } = await import("@/modules/notifications/monitor");
const { authorizeCron } = await import("@/lib/security/cron");

describe("Vercel Production Monitor (Step 5 Quality & Security Suite)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJobRunsStore = {};
    sentEmails.length = 0;
    mockEmailSendFailure = false;
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

  describe("1-3. CRON_SECRET Authorization Guardrails", () => {
    const dummySecret = "a".repeat(32);

    it("1. Rejects request without CRON_SECRET", () => {
      vi.stubEnv("CRON_SECRET", dummySecret);
      expect(() => authorizeCron(new Request("http://x/api/jobs/monitor"))).toThrow();
    });

    it("2. Rejects request with wrong secret", () => {
      vi.stubEnv("CRON_SECRET", dummySecret);
      expect(() =>
        authorizeCron(
          new Request("http://x/api/jobs/monitor", {
            headers: { authorization: "Bearer invalid-secret-value-12345" },
          })
        )
      ).toThrow();
    });

    it("3. Authorizes valid CRON_SECRET bearer request", () => {
      vi.stubEnv("CRON_SECRET", dummySecret);
      expect(() =>
        authorizeCron(
          new Request("http://x/api/jobs/monitor", {
            headers: { authorization: `Bearer ${dummySecret}` },
          })
        )
      ).not.toThrow();
    });
  });

  describe("4. All Probes Healthy", () => {
    it("reports healthy when app, database, and all cron jobs are operational", async () => {
      const res = await runProductionMonitor();
      expect(res.healthy).toBe(true);
      expect(res.checks.app.status).toBe("ok");
      expect(res.checks.database.status).toBe("ready");
      expect(res.checks.cron.status).toBe("healthy");
      expect(res.incident.status).toBe("healthy");
      expect(res.incident.alertSent).toBe(false);
      expect(sentEmails.length).toBe(0);
    });
  });

  describe("5. Database Readiness Failure Detection", () => {
    it("detects database failure, triggers alert, and includes details", async () => {
      mockDbReady.mockResolvedValue(false);

      const res = await runProductionMonitor();
      expect(res.healthy).toBe(false);
      expect(res.checks.database.status).toBe("unavailable");
      expect(res.incident.status).toBe("triggered");
      expect(res.incident.failingComponents).toContain("database");
      expect(res.incident.alertSent).toBe(true);
      expect(sentEmails.length).toBe(1);
      expect(sentEmails[0].to).toBe("operator@turim.d2ryf.com");
      expect(sentEmails[0].subject).toContain("[ALERT]");
      expect(sentEmails[0].subject).toContain("database");
    });
  });

  describe("6. Stale Cron Jobs Failure Detection", () => {
    it("detects stale cron job, identifies failing component, and sends alert", async () => {
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [
          { job: "outbox", lastOk: new Date(Date.now() - 3600_000).toISOString(), ageMinutes: 60, failed24h: 5, stale: true },
          { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
          { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 1, failed24h: 0, stale: false },
          { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 60, failed24h: 0, stale: false },
        ],
      });

      const res = await runProductionMonitor();
      expect(res.healthy).toBe(false);
      expect(res.checks.cron.status).toBe("unhealthy");
      expect(res.incident.failingComponents).toContain("cron:outbox");
      expect(res.incident.alertSent).toBe(true);
      expect(sentEmails.length).toBe(1);
      expect(sentEmails[0].subject).toContain("cron:outbox");
    });
  });

  describe("7. Resend Email Failure Handling", () => {
    it("handles Resend delivery error safely without crashing and records alertError", async () => {
      mockDbReady.mockResolvedValue(false);
      mockEmailSendFailure = true;

      const res = await runProductionMonitor();
      expect(res.healthy).toBe(false);
      expect(res.incident.alertSent).toBe(false);
      expect(res.incident.alertError).toBe("Resend rate limit exceeded (transient)");
    });
  });

  describe("8. Deduplication of Ongoing Incidents", () => {
    it("does not send duplicate alert emails on consecutive failing runs with the same components", async () => {
      mockDbReady.mockResolvedValue(false);

      // Run 1: First detection
      const run1 = await runProductionMonitor();
      expect(run1.incident.status).toBe("triggered");
      expect(run1.incident.alertSent).toBe(true);
      expect(sentEmails.length).toBe(1);

      // Run 2: 15 minutes later, still failing
      const run2 = await runProductionMonitor();
      expect(run2.incident.status).toBe("ongoing");
      expect(run2.incident.alertSent).toBe(false);
      expect(sentEmails.length).toBe(1); // No new email sent!

      // Run 3: 30 minutes later, still failing
      const run3 = await runProductionMonitor();
      expect(run3.incident.status).toBe("ongoing");
      expect(run3.incident.alertSent).toBe(false);
      expect(sentEmails.length).toBe(1); // Still exactly 1 email!
    });
  });

  describe("9. Recovery Notification", () => {
    it("sends exactly one recovery email when all systems return to operational status", async () => {
      // Step 1: System fails
      mockDbReady.mockResolvedValue(false);
      await runProductionMonitor();
      expect(sentEmails.length).toBe(1);

      // Step 2: System recovers
      mockDbReady.mockResolvedValue(true);
      const res = await runProductionMonitor();
      expect(res.healthy).toBe(true);
      expect(res.incident.status).toBe("recovered");
      expect(res.incident.alertSent).toBe(true);
      expect(sentEmails.length).toBe(2);
      expect(sentEmails[1].subject).toContain("[RESOLVED]");

      // Step 3: Next run stays healthy -> No new email!
      const nextRun = await runProductionMonitor();
      expect(nextRun.healthy).toBe(true);
      expect(nextRun.incident.status).toBe("healthy");
      expect(nextRun.incident.alertSent).toBe(false);
      expect(sentEmails.length).toBe(2);
    });
  });

  describe("10. Material Change in Incident Updates Operator", () => {
    it("sends an updated alert if a new component fails during an ongoing incident", async () => {
      // Initially, only database fails
      mockDbReady.mockResolvedValue(false);
      await runProductionMonitor();
      expect(sentEmails.length).toBe(1);
      expect(sentEmails[0].subject).toContain("database");

      // Next run, both database and cron fail
      mockJobHealth.mockResolvedValue({
        ok: false,
        jobs: [{ job: "reminders", lastOk: null, ageMinutes: null, failed24h: 1, stale: true }],
      });
      await runProductionMonitor({ simulate: "cron" });
      expect(sentEmails.length).toBe(2);
      expect(sentEmails[1].subject).toContain("cron:outbox");
    });
  });

  describe("11. Zero Leakage of Secrets or Customer PII", () => {
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

  describe("12. Safe Operator Simulation Mode", () => {
    it("allows simulating database failure without impacting real DB", async () => {
      const res = await runProductionMonitor({ simulate: "database" });
      expect(res.healthy).toBe(false);
      expect(res.checks.database.status).toBe("unavailable");
      expect(res.incident.failingComponents).toContain("database");
    });

    it("allows simulating cron failure without impacting real jobs", async () => {
      const res = await runProductionMonitor({ simulate: "cron" });
      expect(res.healthy).toBe(false);
      expect(res.checks.cron.status).toBe("unhealthy");
      expect(res.incident.failingComponents).toContain("cron:outbox");
    });
  });
});
