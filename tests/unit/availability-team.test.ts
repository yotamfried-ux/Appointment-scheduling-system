import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { eligiblePeople, insideHours, orderCandidates, peopleOpenAt, teamAvailabilityForRange, teamSlotsForDay, teamWindowsForDate, type TeamException, type TeamPerson, type TeamRule } from "@/modules/availability/team";
import { slotsForDay } from "@/modules/availability/slots";

const TZ = "Asia/Jerusalem";
const H = (h: number, m = 0) => h * 60 + m;
const NOW = new Date("2026-10-01T00:00:00Z");
const DATE = "2026-10-14"; // Wednesday
const A: TeamPerson = { id: "a", name: "דנה" };
const B: TeamPerson = { id: "b", name: "נועם" };
const C: TeamPerson = { id: "c", name: "רון" };
const team = [A, B, C];
const rule = (resourceId: string, from: number, to: number, weekday = 3): TeamRule => ({ resourceId, weekday, startMinute: from, endMinute: to });
const iso = (hhmm: string) => new Date(`${DATE}T${hhmm}:00+03:00`);
const busy = (resourceId: string, from: string, to: string) => ({ resourceId, start: iso(from), end: iso(to) });
const input = { date: DATE, timeZone: TZ, durationMinutes: 60, stepMinutes: 30, now: NOW };

describe("eligiblePeople (T2)", () => {
  it("no restriction (null or empty) = everybody; a list narrows; a chosen person narrows further", () => {
    expect(eligiblePeople(team, null).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(eligiblePeople(team, []).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(eligiblePeople(team, ["c", "a"]).map((p) => p.id)).toEqual(["a", "c"]); // team order, not list order
    expect(eligiblePeople(team, ["a", "b"], "b").map((p) => p.id)).toEqual(["b"]);
  });
  it("negative control: a chosen person who may not do the service leaves nobody (never silently someone else)", () => {
    expect(eligiblePeople(team, ["a", "b"], "c")).toEqual([]);
    expect(eligiblePeople(team, null, "zzz")).toEqual([]);
  });
});

describe("teamSlotsForDay (T4): a time is offered when at least one eligible person is open and free", () => {
  const rules = [rule("a", H(9), H(12)), rule("b", H(10), H(14)), rule("c", H(9), H(10))];
  it("is the union of the people's own hours, and says who is free at each time", () => {
    const s = teamSlotsForDay({ ...input, people: team, rules, exceptions: [], busy: [] });
    expect(s.map((x) => x.local)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00"]);
    expect(s.find((x) => x.local === "09:00")!.freeIds.sort()).toEqual(["a", "c"]);
    expect(s.find((x) => x.local === "10:00")!.freeIds.sort()).toEqual(["a", "b"]);
    expect(s.find((x) => x.local === "12:30")!.freeIds).toEqual(["b"]);
  });
  it("one busy person does not remove the time while another is free; both busy removes it", () => {
    const one = teamSlotsForDay({ ...input, people: team, rules, exceptions: [], busy: [busy("a", "10:00", "11:00")] });
    expect(one.find((x) => x.local === "10:00")!.freeIds).toEqual(["b"]);
    const both = teamSlotsForDay({ ...input, people: team, rules, exceptions: [], busy: [busy("a", "10:00", "11:00"), busy("b", "10:00", "11:00")] });
    expect(both.some((x) => x.local === "10:00")).toBe(false); // negative control
  });
  it("a busy range of one person never blocks another person (the old single-calendar bug)", () => {
    const s = teamSlotsForDay({ ...input, people: [A, B], rules: [rule("a", H(9), H(12)), rule("b", H(9), H(12))], exceptions: [], busy: [busy("a", "09:00", "12:00")] });
    expect(s.map((x) => x.local)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00"]);
    expect(s.every((x) => x.freeIds.join() === "b")).toBe(true);
  });
  it("choosing a person narrows the offer to that person", () => {
    const s = teamSlotsForDay({ ...input, people: eligiblePeople(team, null, "b"), rules, exceptions: [], busy: [] });
    expect(s.map((x) => x.local)[0]).toBe("10:00");
    expect(s.every((x) => x.freeIds.join() === "b")).toBe(true);
  });
  it("T9: a closure without a person closes everybody; a person's own exception closes only that person", () => {
    const ex: TeamException[] = [{ resourceId: null, date: DATE, kind: "closed", startMinute: H(9), endMinute: H(10) }];
    const all = teamSlotsForDay({ ...input, people: team, rules, exceptions: ex, busy: [] });
    expect(all.map((x) => x.local)[0]).toBe("10:00");
    const own: TeamException[] = [{ resourceId: "a", date: DATE, kind: "closed" }];
    const s = teamSlotsForDay({ ...input, people: team, rules, exceptions: own, busy: [] });
    expect(s.find((x) => x.local === "10:00")!.freeIds).toEqual(["b"]);
    expect(s.find((x) => x.local === "09:00")!.freeIds).toEqual(["c"]);
  });
  it("a one-person team gives exactly what the single-calendar engine gives (solo regression)", () => {
    const solo = teamSlotsForDay({ ...input, people: [A], rules: [rule("a", H(9), H(12)), rule("a", H(13), H(17))], exceptions: [], busy: [busy("a", "10:00", "11:00")] });
    const old = slotsForDay({ ...input, rules: [{ weekday: 3, startMinute: H(9), endMinute: H(12) }, { weekday: 3, startMinute: H(13), endMinute: H(17) }], exceptions: [], busy: [{ start: iso("10:00"), end: iso("11:00") }] });
    expect(solo.map((x) => x.startUtc)).toEqual(old.map((x) => x.startUtc));
  });
  it("property: the union equals the union of each person's own slots", () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.constantFrom("a", "b", "c"), fc.integer({ min: 8, max: 14 }), fc.integer({ min: 1, max: 6 })), { minLength: 1, maxLength: 6 }), fc.array(fc.tuple(fc.constantFrom("a", "b", "c"), fc.integer({ min: 8, max: 18 })), { maxLength: 5 }), (rs, bs) => {
      const rules2 = rs.map(([id, from, len]) => rule(id, H(from), H(Math.min(from + len, 20))));
      const busy2 = bs.map(([id, h]) => busy(id, `${String(h).padStart(2, "0")}:00`, `${String(h + 1).padStart(2, "0")}:00`));
      const got = teamSlotsForDay({ ...input, people: team, rules: rules2, exceptions: [], busy: busy2 }).map((x) => x.startUtc);
      const want = new Set(team.flatMap((p) => slotsForDay({ ...input, rules: rules2.filter((r) => r.resourceId === p.id), exceptions: [], busy: busy2.filter((b) => b.resourceId === p.id) }).map((x) => x.startUtc)));
      expect(got).toEqual([...want].sort());
    }));
  });
});

describe("teamWindowsForDate / teamAvailabilityForRange", () => {
  const rules = [rule("a", H(9), H(12)), rule("b", H(11), H(15))];
  it("windows are merged across people", () => {
    expect(teamWindowsForDate(DATE, team, rules, [])).toEqual([{ from: H(9), to: H(15) }]);
  });
  it("a day is closed only when nobody works", () => {
    const r = teamAvailabilityForRange({ ...input, people: team, rules, exceptions: [{ resourceId: null, date: DATE, kind: "closed" }], busy: [], from: DATE, days: 2 });
    expect(r[0]).toMatchObject({ date: DATE, closed: true, freeSlots: 0 });
    expect(r[1].closed).toBe(true); // Thursday: no weekday-4 rules
  });
  it("free-slot counts are the union counts", () => {
    const r = teamAvailabilityForRange({ ...input, people: team, rules, exceptions: [], busy: [], from: DATE, days: 1 });
    expect(r[0].freeSlots).toBe(teamSlotsForDay({ ...input, people: team, rules, exceptions: [], busy: [] }).length);
  });
});

describe("orderCandidates (T5): fewest appointments that day, then team position", () => {
  const counts = (o: Record<string, number>) => (id: string) => o[id] ?? 0;
  it("ties go to the earlier position", () => {
    expect(orderCandidates(team, ["c", "a", "b"], counts({}))).toEqual(["a", "b", "c"]);
  });
  it("fewer appointments first", () => {
    expect(orderCandidates(team, ["a", "b", "c"], counts({ a: 3, b: 1, c: 2 }))).toEqual(["b", "c", "a"]);
  });
  it("only the people given are returned (nobody is invented back in)", () => {
    expect(orderCandidates(team, ["c", "b"], counts({ b: 5 }))).toEqual(["c", "b"]);
  });
  it("property: deterministic and a permutation of the input", () => {
    fc.assert(fc.property(fc.subarray(["a", "b", "c"], { minLength: 1 }), fc.record({ a: fc.nat(5), b: fc.nat(5), c: fc.nat(5) }), (ids, n) => {
      const r = orderCandidates(team, ids, (id) => (n as Record<string, number>)[id]);
      expect([...r].sort()).toEqual([...ids].sort());
      expect(orderCandidates(team, [...ids].reverse(), (id) => (n as Record<string, number>)[id])).toEqual(r);
    }));
  });
});

describe("peopleOpenAt", () => {
  it("returns the people whose own hours allow the requested start (ignoring who is busy), in team order", () => {
    const rules = [rule("a", H(9), H(12)), rule("b", H(10), H(14)), rule("c", H(9), H(10))];
    expect(peopleOpenAt({ ...input, people: team, rules, exceptions: [], time: "10:00" }).map((p) => p.id)).toEqual(["a", "b"]);
    expect(peopleOpenAt({ ...input, people: team, rules, exceptions: [], time: "09:00" }).map((p) => p.id)).toEqual(["a", "c"]);
    expect(peopleOpenAt({ ...input, people: team, rules, exceptions: [], time: "13:30" }).map((p) => p.id)).toEqual([]);
  });
});

describe("insideHours (owner bookings)", () => {
  const rules = [rule("a", H(9), H(12)), rule("b", H(13), H(17))];
  const args = { date: DATE, durationMinutes: 60, rules, exceptions: [] as TeamException[] };
  it("counts the people given: a visit in b's hours is inside for b (or anyone) but not for a alone", () => {
    expect(insideHours({ ...args, startMinute: H(14), people: [B] })).toBe(true);
    expect(insideHours({ ...args, startMinute: H(14), people: team })).toBe(true);
    expect(insideHours({ ...args, startMinute: H(14), people: [A] })).toBe(false); // negative control
  });
  it("the whole visit must fit, and a closure removes it", () => {
    expect(insideHours({ ...args, startMinute: H(11, 30), people: [A] })).toBe(false);
    expect(insideHours({ ...args, startMinute: H(10), people: [A], exceptions: [{ resourceId: null, date: DATE, kind: "closed" }] })).toBe(false);
  });
});
