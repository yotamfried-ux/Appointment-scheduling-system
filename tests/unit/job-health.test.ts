import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/platform/system-db", () => ({ systemDb: () => ({}) }));

const { assess, EXPECTED_MAX_AGE_MINUTES } = await import("@/modules/notifications/job-health");

const NOW = Date.parse("2026-10-12T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const fresh = Object.keys(EXPECTED_MAX_AGE_MINUTES).map((job) => ({ job, lastOk: ago(1), failed24h: 0 }));

describe("job heartbeat assessment (OPS-06)", () => {
  it("is healthy when every expected job succeeded recently", () => {
    const h = assess(fresh, NOW);
    expect(h.ok).toBe(true);
    expect(h.jobs.every((j) => !j.stale)).toBe(true);
  });
  it("a job that stopped is stale after its allowed age, not before", () => {
    const limit = EXPECTED_MAX_AGE_MINUTES.outbox;
    const at = (age: number) => assess(fresh.map((r) => (r.job === "outbox" ? { ...r, lastOk: ago(age) } : r)), NOW);
    expect(at(limit).ok).toBe(true);
    expect(at(limit + 1).ok).toBe(false);
    expect(at(limit + 1).jobs.find((j) => j.job === "outbox")?.stale).toBe(true);
  });
  it("a job that has NEVER run is reported (a cron that was never enabled must not look healthy)", () => {
    const h = assess(fresh.filter((r) => r.job !== "reminders"), NOW);
    expect(h.ok).toBe(false);
    expect(h.jobs.find((j) => j.job === "reminders")).toMatchObject({ lastOk: null, ageMinutes: null, stale: true });
  });
  it("a job that only ever failed counts as never succeeded", () => {
    const h = assess(fresh.map((r) => (r.job === "waitlist" ? { ...r, lastOk: null, failed24h: 9 } : r)), NOW);
    expect(h.jobs.find((j) => j.job === "waitlist")).toMatchObject({ stale: true, failed24h: 9 });
  });
  it("an unknown extra job is ignored rather than breaking the answer", () => {
    expect(assess([...fresh, { job: "experiment", lastOk: ago(99999), failed24h: 0 }], NOW).ok).toBe(true);
  });
});
