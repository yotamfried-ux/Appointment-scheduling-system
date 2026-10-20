import { describe, expect, it } from "vitest";
import { todayInBusinessZone } from "@/lib/lab/booking-data";

// Regression: the real booking page used a fixed prototype date, so its 28-day window slid into the past and ran out in November 2026.
describe("todayInBusinessZone", () => {
  it("is the calendar date in Israel, not in UTC", () => {
    expect(todayInBusinessZone(new Date("2026-10-20T22:30:00Z"))).toBe("2026-10-21"); // 01:30 the next day in Israel (IDT, UTC+3)
    expect(todayInBusinessZone(new Date("2026-12-31T22:30:00Z"))).toBe("2027-01-01"); // 00:30 in Israel (IST, UTC+2): already the next year
  });
  it("follows the clock, so the window moves with time", () => {
    expect(todayInBusinessZone(new Date("2026-11-15T10:00:00Z"))).toBe("2026-11-15");
  });
});
