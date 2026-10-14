import { describe, expect, it } from "vitest";
import {
  computeGaps,
  teamOccupancyPct,
  dashboardReducer,
  initialDashboard,
  todayStats,
  toRibbon,
  type DashboardState,
  type LabAppointment,
} from "@/lib/lab/dashboard-data";

const H = (h: number, m = 0) => h * 60 + m;
const appt = (id: string, start: number, end: number, status: LabAppointment["status"] = "confirmed"): LabAppointment => ({
  id, start, end, status, customer: id, service: "תספורת",
});

describe("computeGaps", () => {
  it("returns free windows between active appointments, ordered", () => {
    const gaps = computeGaps([appt("a", H(9), H(10)), appt("b", H(11), H(12))], H(9), H(14), 30);
    expect(gaps).toEqual([{ start: H(10), end: H(11) }, { start: H(12), end: H(14) }]);
  });

  it("ignores cancelled appointments but counts pending ones as busy", () => {
    const gaps = computeGaps([appt("a", H(9), H(10), "cancelled"), appt("b", H(10), H(11), "pending")], H(9), H(12), 30);
    expect(gaps).toEqual([{ start: H(9), end: H(10) }, { start: H(11), end: H(12) }]);
  });

  it("drops gaps shorter than the minimum useful length", () => {
    const gaps = computeGaps([appt("a", H(9), H(10)), appt("b", H(10, 20), H(12))], H(9), H(12), 30);
    expect(gaps).toEqual([]);
  });

  it("handles overlapping and unsorted input and an empty day", () => {
    expect(computeGaps([appt("b", H(10), H(12)), appt("a", H(9), H(11))], H(9), H(13), 30)).toEqual([{ start: H(12), end: H(13) }]);
    expect(computeGaps([], H(9), H(11), 30)).toEqual([{ start: H(9), end: H(11) }]);
  });
});

describe("dashboardReducer", () => {
  it("approving a pending appointment confirms it", () => {
    const s = dashboardReducer(initialDashboard, { type: "approve", id: "p1" });
    expect(s.appointments.find((a) => a.id === "p1")!.status).toBe("confirmed");
  });

  it("rejecting a pending appointment cancels it and frees its time", () => {
    const before = computeGaps(initialDashboard.appointments, H(9), H(18), 30);
    const s = dashboardReducer(initialDashboard, { type: "reject", id: "p1" });
    expect(s.appointments.find((a) => a.id === "p1")!.status).toBe("cancelled");
    expect(computeGaps(s.appointments, H(9), H(18), 30).length).toBeGreaterThanOrEqual(before.length);
  });

  it("cannot approve something that is not pending (state-machine guard)", () => {
    const confirmed = initialDashboard.appointments.find((a) => a.status === "confirmed")!;
    const s = dashboardReducer(initialDashboard, { type: "approve", id: confirmed.id });
    expect(s).toBe(initialDashboard);
  });

  it("approving a cancellation request cancels the appointment; declining keeps it", () => {
    const req = initialDashboard.appointments.find((a) => a.status === "cancellationRequested")!;
    expect(dashboardReducer(initialDashboard, { type: "approveCancellation", id: req.id }).appointments.find((a) => a.id === req.id)!.status).toBe("cancelled");
    expect(dashboardReducer(initialDashboard, { type: "declineCancellation", id: req.id }).appointments.find((a) => a.id === req.id)!.status).toBe("confirmed");
  });

  it("unknown ids are ignored", () => {
    expect(dashboardReducer(initialDashboard, { type: "approve", id: "nope" })).toBe(initialDashboard);
  });
});

describe("todayStats / toRibbon", () => {
  it("counts today's appointments, pending, and occupancy from real data", () => {
    const stats = todayStats(initialDashboard.appointments, H(9), H(18));
    expect(stats.total).toBe(initialDashboard.appointments.filter((a) => a.status !== "cancelled").length);
    expect(stats.pending).toBe(initialDashboard.appointments.filter((a) => a.status === "pending").length);
    expect(stats.occupancyPct).toBeGreaterThan(0);
    expect(stats.occupancyPct).toBeLessThanOrEqual(100);
  });

  it("produces ribbon segments covering booked, pending and free time", () => {
    const segs = toRibbon(initialDashboard.appointments, H(9), H(18));
    const states = new Set(segs.map((s) => s.state));
    expect(states.has("booked")).toBe(true);
    expect(states.has("pending")).toBe(true);
    expect(states.has("free")).toBe(true);
    for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBeGreaterThanOrEqual(segs[i - 1].end);
  });
});

import { formatDuration } from "@/lib/lab/dashboard-data";

describe("formatDuration (Hebrew)", () => {
  it.each([
    [20, "20 דק׳"],
    [30, "30 דק׳"],
    [60, "שעה"],
    [90, "שעה ו-30 דק׳"],
    [120, "שעתיים"],
    [150, "שעתיים ו-30 דק׳"],
    [180, "3 שעות"],
  ])("%i minutes → %s", (m, text) => expect(formatDuration(m)).toBe(text));
});

describe("owner actions on the same state machine (stage 5)", () => {
  const mk = (status: LabAppointment["status"]): DashboardState => ({ appointments: [{ id: "x", start: 600, end: 630, customer: "ד", service: "ש", status }] });
  const st = (s: DashboardState) => s.appointments[0].status;
  it("cancel works from confirmed and pending only", () => {
    expect(st(dashboardReducer(mk("confirmed"), { type: "cancel", id: "x" }))).toBe("cancelled");
    expect(st(dashboardReducer(mk("pending"), { type: "cancel", id: "x" }))).toBe("cancelled");
    for (const s of ["completed", "noShow", "cancelled", "cancellationRequested"] as const) expect(st(dashboardReducer(mk(s), { type: "cancel", id: "x" }))).toBe(s);
  });
  it("complete and noShow start from confirmed; a wrong mark can be corrected to the other one (NSH-04)", () => {
    expect(st(dashboardReducer(mk("confirmed"), { type: "complete", id: "x" }))).toBe("completed");
    expect(st(dashboardReducer(mk("confirmed"), { type: "noShow", id: "x" }))).toBe("noShow");
    expect(st(dashboardReducer(mk("noShow"), { type: "complete", id: "x" }))).toBe("completed");
    expect(st(dashboardReducer(mk("completed"), { type: "noShow", id: "x" }))).toBe("noShow");
  });
  it("complete and noShow never apply to anything else", () => {
    for (const s of ["pending", "cancelled", "cancellationRequested"] as const) {
      expect(st(dashboardReducer(mk(s), { type: "complete", id: "x" }))).toBe(s);
      expect(st(dashboardReducer(mk(s), { type: "noShow", id: "x" }))).toBe(s);
    }
    // marking the same outcome again is a no-op, not an error
    expect(st(dashboardReducer(mk("completed"), { type: "complete", id: "x" }))).toBe("completed");
    expect(st(dashboardReducer(mk("noShow"), { type: "noShow", id: "x" }))).toBe("noShow");
  });
  it("an unknown id changes nothing", () => {
    const s = mk("confirmed");
    expect(dashboardReducer(s, { type: "complete", id: "nope" })).toBe(s);
  });
});

describe("teamOccupancyPct (stage 16)", () => {
  const appt = (start: number, end: number): LabAppointment => ({ id: `${start}`, start, end, customer: "x", service: "s", status: "confirmed" });
  it("is booked minutes over everybody's open minutes, so two people booked at once stay under 100%", () => {
    const w = [{ from: H(9), to: H(17) }];
    expect(teamOccupancyPct([{ appts: [appt(H(9), H(13))], windows: w }, { appts: [appt(H(9), H(13))], windows: w }])).toBe(50);
    expect(teamOccupancyPct([{ appts: [appt(H(9), H(17))], windows: w }, { appts: [], windows: w }])).toBe(50); // negative control: one person full, one idle
  });
  it("nobody working is 0%, not NaN", () => expect(teamOccupancyPct([{ appts: [], windows: [] }])).toBe(0));
});
