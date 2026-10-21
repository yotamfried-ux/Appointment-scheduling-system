import { describe, expect, it } from "vitest";
import { dayLengthMinutes, FixedClock, zonedParts, zonedTimeToUtc } from "@/platform/clock";

const TZ = "Asia/Jerusalem";

describe("FixedClock", () => {
  it("returns a controllable now and does not leak mutation", () => {
    const c = new FixedClock(new Date("2026-10-14T08:00:00Z"));
    const a = c.now();
    a.setFullYear(1999);
    expect(c.now().toISOString()).toBe("2026-10-14T08:00:00.000Z");
    c.advance(60_000);
    expect(c.now().toISOString()).toBe("2026-10-14T08:01:00.000Z");
  });
});

describe("zonedParts", () => {
  it("reads local date, minutes and weekday in the business zone", () => {
    expect(zonedParts(new Date("2026-10-14T08:10:00Z"), TZ)).toEqual({ date: "2026-10-14", minutes: 11 * 60 + 10, weekday: 3 });
  });
  it("crosses midnight correctly", () => {
    expect(zonedParts(new Date("2026-10-14T21:30:00Z"), TZ)).toMatchObject({ date: "2026-10-15", minutes: 30 }); // 00:30 local
  });
});

describe("zonedTimeToUtc (DST, docs/04 AVL-DST)", () => {
  it("summer (UTC+3): 09:00 local = 06:00Z", () => {
    expect(zonedTimeToUtc("2026-10-14", 9 * 60, TZ).toISOString()).toBe("2026-10-14T06:00:00.000Z");
  });
  it("winter (UTC+2): 09:00 local = 07:00Z", () => {
    expect(zonedTimeToUtc("2026-12-14", 9 * 60, TZ).toISOString()).toBe("2026-12-14T07:00:00.000Z");
  });
  it("round-trips every half hour on a normal day", () => {
    for (let m = 0; m < 1440; m += 30) {
      const p = zonedParts(zonedTimeToUtc("2026-11-04", m, TZ), TZ);
      expect(p).toMatchObject({ date: "2026-11-04", minutes: m });
    }
  });
  it("fall back 2026-10-25: the day has 25 hours and 09:00 is already winter time", () => {
    expect(dayLengthMinutes("2026-10-25", TZ)).toBe(25 * 60);
    expect(zonedTimeToUtc("2026-10-25", 9 * 60, TZ).toISOString()).toBe("2026-10-25T07:00:00.000Z");
  });
  it("spring forward 2026-03-27: the day has 23 hours and 09:00 is summer time", () => {
    expect(dayLengthMinutes("2026-03-27", TZ)).toBe(23 * 60);
    expect(zonedTimeToUtc("2026-03-27", 9 * 60, TZ).toISOString()).toBe("2026-03-27T06:00:00.000Z");
  });
  it("a local time inside the spring-forward gap (02:30) maps to 03:30 local, deterministically", () => {
    const u = zonedTimeToUtc("2026-03-27", 2 * 60 + 30, TZ);
    expect(zonedParts(u, TZ)).toMatchObject({ date: "2026-03-27", minutes: 3 * 60 + 30 });
  });
  it("a repeated hour on fall-back (01:30) returns the earlier occurrence", () => {
    const u = zonedTimeToUtc("2026-10-25", 60 + 30, TZ);
    expect(u.toISOString()).toBe("2026-10-24T22:30:00.000Z");
  });
  it("a normal day has 24 hours", () => {
    expect(dayLengthMinutes("2026-06-10", TZ)).toBe(24 * 60);
  });
});
