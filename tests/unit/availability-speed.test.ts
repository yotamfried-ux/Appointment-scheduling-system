import { describe, expect, it } from "vitest";
import { teamAvailabilityForRange } from "@/modules/availability/team";
import { zonedParts, zonedTimeToUtc } from "@/platform/clock";

// Regression: the time-zone helper used to rebuild an Intl formatter several times per slot, so a 3-person, 28-day availability call took ~750 ms of CPU.
describe("availability stays fast", () => {
  const people = [0, 1, 2].map((i) => ({ id: `p${i}`, name: `p${i}` }));
  const rules = people.flatMap((p) => [0, 1, 2, 3, 4, 5].map((w) => ({ resourceId: p.id, weekday: w, startMinute: 9 * 60, endMinute: 18 * 60 })));
  const input = { timeZone: "Asia/Jerusalem", durationMinutes: 30, bufferMinutes: 5, stepMinutes: 30, now: new Date("2026-10-21T08:00:00Z"), minNoticeMinutes: 0, people, rules, exceptions: [], busy: [], from: "2026-10-21", days: 28 };

  it("3 people x 28 days is far under a quarter of a second (it was ~750 ms)", () => {
    teamAvailabilityForRange(input); // warm-up
    const t = performance.now();
    teamAvailabilityForRange(input);
    expect(performance.now() - t).toBeLessThan(250);
  });

  it("remembering conversions changes no answer: repeated calls agree with each other, across the DST changes", () => {
    for (const [date, minutes] of [["2026-03-27", 150], ["2026-03-27", 120], ["2026-10-25", 90], ["2026-10-25", 60], ["2026-07-01", 600]] as const) {
      const a = zonedTimeToUtc(date, minutes, "Asia/Jerusalem");
      const b = zonedTimeToUtc(date, minutes, "Asia/Jerusalem");
      expect(b.getTime()).toBe(a.getTime());
      expect(zonedParts(a, "Asia/Jerusalem").date).toBeTypeOf("string");
    }
    const first = zonedTimeToUtc("2026-07-01", 600, "Asia/Jerusalem");
    first.setTime(0); // a caller changing its copy must not change what the next caller gets
    expect(zonedTimeToUtc("2026-07-01", 600, "Asia/Jerusalem").toISOString()).toBe("2026-07-01T07:00:00.000Z");
  });
});
