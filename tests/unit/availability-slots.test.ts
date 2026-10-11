import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDaysIso, availabilityForRange, slotsForDay, weekdayOfDate, windowsForDate, type DayException, type WeeklyRule } from "@/modules/availability/slots";
import { zonedParts, zonedTimeToUtc } from "@/platform/clock";

const TZ = "Asia/Jerusalem";
const H = (h: number, m = 0) => h * 60 + m;
const NOW = new Date("2026-10-01T00:00:00Z");
const week = (windows: [number, number][], days = [0, 1, 2, 3, 4]): WeeklyRule[] => days.flatMap((weekday) => windows.map(([s, e]) => ({ weekday, startMinute: s, endMinute: e })));
const base = { timeZone: TZ, rules: week([[H(9), H(12)], [H(13), H(17)]]), exceptions: [] as DayException[], durationMinutes: 60, stepMinutes: 30, now: NOW };

describe("windowsForDate (AVL-01/05/07)", () => {
  it("2026-10-14 is a Wednesday", () => expect(weekdayOfDate("2026-10-14")).toBe(3));
  it("returns the split-day windows for an open weekday and nothing for a closed one", () => {
    expect(windowsForDate("2026-10-14", base.rules, [])).toEqual([{ from: H(9), to: H(12) }, { from: H(13), to: H(17) }]);
    expect(windowsForDate("2026-10-17", base.rules, [])).toEqual([]); // Saturday
  });
  it("a full-day closure wins over everything, even a special opening", () => {
    const ex: DayException[] = [{ date: "2026-10-14", kind: "open", startMinute: H(10), endMinute: H(11) }, { date: "2026-10-14", kind: "closed" }];
    expect(windowsForDate("2026-10-14", base.rules, ex)).toEqual([]);
  });
  it("a partial closure cuts a window in two; closing a whole window removes it", () => {
    expect(windowsForDate("2026-10-14", base.rules, [{ date: "2026-10-14", kind: "closed", startMinute: H(10), endMinute: H(11) }])).toEqual([{ from: H(9), to: H(10) }, { from: H(11), to: H(12) }, { from: H(13), to: H(17) }]);
    expect(windowsForDate("2026-10-14", base.rules, [{ date: "2026-10-14", kind: "closed", startMinute: H(12), endMinute: H(18) }])).toEqual([{ from: H(9), to: H(12) }]);
  });
  it("a special opening adds hours on a closed day and merges with touching windows", () => {
    expect(windowsForDate("2026-10-17", base.rules, [{ date: "2026-10-17", kind: "open", startMinute: H(10), endMinute: H(14) }])).toEqual([{ from: H(10), to: H(14) }]);
    expect(windowsForDate("2026-10-14", base.rules, [{ date: "2026-10-14", kind: "open", startMinute: H(12), endMinute: H(13) }])).toEqual([{ from: H(9), to: H(17) }]);
  });
  it("ignores exceptions of other dates", () => {
    expect(windowsForDate("2026-10-14", base.rules, [{ date: "2026-10-15", kind: "closed" }])).toHaveLength(2);
  });
});

describe("slotsForDay (AVL-02/03)", () => {
  it("offers aligned starts inside the windows, never one that would end after closing", () => {
    const s = slotsForDay({ ...base, date: "2026-10-14" });
    expect(s.map((x) => x.local)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00"]);
  });
  it("returns UTC instants for the local times (UTC+3 in October 2026 before DST ends)", () => {
    expect(slotsForDay({ ...base, date: "2026-10-14" })[0].startUtc).toBe("2026-10-14T06:00:00.000Z");
  });
  it("hides past times today and respects the minimum notice", () => {
    const now = new Date("2026-10-14T07:10:00Z"); // 10:10 local
    expect(slotsForDay({ ...base, date: "2026-10-14", now })[0].local).toBe("10:30");
    expect(slotsForDay({ ...base, date: "2026-10-14", now, minNoticeMinutes: 120 })[0].local).toBe("13:00");
  });
  it("a busy interval removes every slot it overlaps; the buffer after the service is protected too", () => {
    const busy = [{ start: new Date("2026-10-14T07:00:00Z"), end: new Date("2026-10-14T08:00:00Z") }]; // 10:00–11:00 local
    const s = slotsForDay({ ...base, date: "2026-10-14", busy }).map((x) => x.local);
    expect(s).not.toContain("09:30");
    expect(s).not.toContain("10:00");
    expect(s).not.toContain("10:30");
    expect(s).toContain("09:00");
    expect(s).toContain("11:00");
    const buffered = slotsForDay({ ...base, date: "2026-10-14", busy, bufferMinutes: 30 }).map((x) => x.local);
    expect(buffered).not.toContain("09:00"); // 09:00–10:00 + 30 min buffer collides with the 10:00 booking
  });
  it("adjacent bookings are fine: ending exactly when the next starts does not overlap", () => {
    const busy = [{ start: new Date("2026-10-14T07:00:00Z"), end: new Date("2026-10-14T08:00:00Z") }];
    expect(slotsForDay({ ...base, date: "2026-10-14", busy }).map((x) => x.local)).toContain("09:00");
  });
  it("closing the day yields no slots", () => {
    expect(slotsForDay({ ...base, date: "2026-10-14", exceptions: [{ date: "2026-10-14", kind: "closed" }] })).toEqual([]);
  });
});

describe("DST (AVL-DST)", () => {
  it("fall back 2026-10-25 (Sunday): UTC+2 again — 09:00 local is 07:00Z and the day still has the same local slots", () => {
    const s = slotsForDay({ ...base, date: "2026-10-25" });
    expect(s[0]).toMatchObject({ local: "09:00", startUtc: "2026-10-25T07:00:00.000Z" });
    expect(s).toHaveLength(12);
  });
  it("spring forward 2026-03-27 (Friday): a window crossing the gap loses only the nonexistent wall times", () => {
    const rules = week([[H(1), H(5)]], [5]);
    const s = slotsForDay({ ...base, rules, durationMinutes: 30, stepMinutes: 30, date: "2026-03-27", now: new Date("2026-03-01T00:00:00Z") });
    const locals = s.map((x) => x.local);
    expect(locals).toContain("01:30");
    expect(locals).not.toContain("02:00"); // does not exist that night
    expect(locals).not.toContain("02:30");
    expect(locals).toContain("03:00");
  });
  it("fall back with a window over the repeated hour (01:00–02:00 happens twice): each wall time appears once, in order, at the earlier instant", () => {
    const rules = week([[H(0), H(4)]], [0]); // Sunday 2026-10-25
    const s = slotsForDay({ ...base, rules, durationMinutes: 30, stepMinutes: 30, date: "2026-10-25" });
    const locals = s.map((x) => x.local);
    expect(new Set(locals).size).toBe(locals.length);
    const instants = s.map((x) => x.startUtc);
    expect([...instants].sort()).toEqual(instants);
    expect(s.find((x) => x.local === "01:30")!.startUtc).toBe("2026-10-24T22:30:00.000Z");
  });
});

describe("availabilityForRange", () => {
  it("reports closed days and free counts per day", () => {
    const r = availabilityForRange({ ...base, from: "2026-10-14", days: 5 });
    expect(r.map((d) => d.date)).toEqual(["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(r.map((d) => d.closed)).toEqual([false, false, true, true, false]); // Fri, Sat closed
    expect(r[0].freeSlots).toBe(12);
    expect(r[2].freeSlots).toBe(0);
  });
});

// ---------------------------------------------------------------- property tests
const zones = fc.constantFrom("Asia/Jerusalem", "UTC", "America/New_York", "Pacific/Auckland", "Europe/London");
// dates around the 2026 DST transitions of those zones plus ordinary days
const dates = fc.oneof(fc.constantFrom("2026-03-27", "2026-03-28", "2026-03-29", "2026-10-24", "2026-10-25", "2026-10-26", "2026-11-01", "2026-04-05", "2026-09-27"), fc.integer({ min: 0, max: 400 }).map((n) => addDaysIso("2026-01-01", n)));
const windowArb = fc.integer({ min: 0, max: 1380 }).chain((s) => fc.integer({ min: s + 15, max: Math.min(1440, s + 600) }).map((e) => [s, e] as const));
const rulesArb = fc.array(fc.record({ weekday: fc.integer({ min: 0, max: 6 }), w: windowArb }), { maxLength: 6 }).map((rs) => {
  // keep only non-overlapping windows per weekday (the database guarantees this)
  const out: WeeklyRule[] = [];
  for (const r of rs) if (!out.some((o) => o.weekday === r.weekday && o.startMinute < r.w[1] && r.w[0] < o.endMinute)) out.push({ weekday: r.weekday, startMinute: r.w[0], endMinute: r.w[1] });
  return out;
});
const input = fc.record({
  timeZone: zones,
  date: dates,
  rules: rulesArb,
  durationMinutes: fc.constantFrom(15, 20, 30, 45, 60, 90),
  stepMinutes: fc.constantFrom(5, 10, 15, 30),
  bufferMinutes: fc.constantFrom(0, 5, 10, 15),
  nowOffsetHours: fc.integer({ min: -48, max: 48 }),
  minNotice: fc.constantFrom(0, 30, 120),
});
type In = typeof input extends fc.Arbitrary<infer T> ? T : never;
const build = (i: In, extra: Partial<Parameters<typeof slotsForDay>[0]> = {}) =>
  slotsForDay({
    date: i.date, timeZone: i.timeZone, rules: i.rules, exceptions: [], durationMinutes: i.durationMinutes, stepMinutes: i.stepMinutes, bufferMinutes: i.bufferMinutes,
    now: new Date(zonedMidnight(i.date, i.timeZone).getTime() + i.nowOffsetHours * 3_600_000), minNoticeMinutes: i.minNotice, ...extra,
  });
const zonedMidnight = (date: string, tz: string) => zonedTimeToUtc(date, 0, tz);

describe("slot properties (fast-check)", () => {
  const cfg = { numRuns: 300 };
  it("every slot lies inside an open window in LOCAL time, aligned to the step, ending before the window closes", () => {
    fc.assert(
      fc.property(input, (i) => {
        const ws = windowsForDate(i.date, i.rules, []);
        for (const s of build(i)) {
          const p = zonedParts(new Date(s.startUtc), i.timeZone);
          expect(p.date).toBe(i.date);
          const w = ws.find((x) => p.minutes >= x.from && p.minutes + i.durationMinutes <= x.to);
          expect(w, `${s.local} not inside ${JSON.stringify(ws)}`).toBeDefined();
          expect((p.minutes - w!.from) % i.stepMinutes).toBe(0);
        }
      }),
      cfg,
    );
  });
  it("slots are unique and strictly increasing in time (no duplicates even on DST days)", () => {
    fc.assert(
      fc.property(input, (i) => {
        const t = build(i).map((s) => Date.parse(s.startUtc));
        for (let k = 1; k < t.length; k++) expect(t[k]).toBeGreaterThan(t[k - 1]);
      }),
      cfg,
    );
  });
  it("no slot starts before now + minimum notice", () => {
    fc.assert(
      fc.property(input, (i) => {
        const now = new Date(zonedMidnight(i.date, i.timeZone).getTime() + i.nowOffsetHours * 3_600_000);
        for (const s of build(i)) expect(Date.parse(s.startUtc)).toBeGreaterThanOrEqual(now.getTime() + i.minNotice * 60_000);
      }),
      cfg,
    );
  });
  it("no slot (plus its buffer) overlaps a busy interval; adding busy time can only REMOVE slots", () => {
    fc.assert(
      fc.property(input, fc.integer({ min: 0, max: 1380 }), fc.integer({ min: 15, max: 240 }), (i, startMin, len) => {
        const all = build(i);
        const day = zonedMidnight(i.date, i.timeZone).getTime();
        const busy = [{ start: new Date(day + startMin * 60_000), end: new Date(day + (startMin + len) * 60_000) }];
        const withBusy = build(i, { busy });
        const allSet = new Set(all.map((s) => s.startUtc));
        for (const s of withBusy) {
          expect(allSet.has(s.startUtc)).toBe(true); // monotone: subset
          const a = Date.parse(s.startUtc);
          const b = a + (i.durationMinutes + i.bufferMinutes) * 60_000;
          expect(a < busy[0].end.getTime() && busy[0].start.getTime() < b).toBe(false);
        }
        expect(withBusy.length).toBeLessThanOrEqual(all.length);
      }),
      cfg,
    );
  });
  it("closing the whole day always yields no slots; a longer service never yields MORE slots", () => {
    fc.assert(
      fc.property(input, (i) => {
        expect(build(i, { exceptions: [{ date: i.date, kind: "closed" }] })).toEqual([]);
        const short = build({ ...i, durationMinutes: 15 }).length;
        const long = build({ ...i, durationMinutes: 90 }).length;
        expect(long).toBeLessThanOrEqual(short);
      }),
      cfg,
    );
  });
});
