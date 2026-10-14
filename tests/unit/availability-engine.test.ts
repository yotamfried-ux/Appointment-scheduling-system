import { describe, expect, it } from "vitest";
import { classifySlots, daySegments, type Interval } from "@/modules/availability/engine";

const H = (h: number, m = 0) => h * 60 + m;
const W = (from: number, to: number) => ({ from, to });

describe("classifySlots", () => {
  it("lists aligned candidates that fit inside a window", () => {
    const r = classifySlots({ windows: [W(H(9), H(11))], durationMinutes: 30, step: 30, buffer: 0, busy: [] });
    expect(r.map((x) => x.start)).toEqual([H(9), H(9, 30), H(10), H(10, 30)]);
    expect(r.every((x) => x.status === "free")).toBe(true);
  });

  it("never offers a start whose service would overrun the window (BKG-15)", () => {
    const r = classifySlots({ windows: [W(H(9), H(11))], durationMinutes: 90, step: 30, buffer: 0, busy: [] });
    expect(r.map((x) => x.start)).toEqual([H(9), H(9, 30)]);
  });

  it("supports split days: slots in each window, none in the break (AVL-01)", () => {
    const r = classifySlots({ windows: [W(H(6), H(8)), W(H(17), H(19))], durationMinutes: 60, step: 60, buffer: 0, busy: [] });
    expect(r.map((x) => x.start)).toEqual([H(6), H(7), H(17), H(18)]);
  });

  it("marks a slot taken when it overlaps a booking", () => {
    const busy: Interval[] = [{ start: H(10), end: H(10, 30) }];
    const r = classifySlots({ windows: [W(H(9), H(12))], durationMinutes: 30, step: 30, buffer: 0, busy });
    expect(r.find((x) => x.start === H(10))!.status).toBe("taken");
    expect(r.find((x) => x.start === H(9, 30))!.status).toBe("free"); // adjacent is fine without buffer
  });

  it("buffer blocks the slot right after and the slot right before a booking (CAT-02)", () => {
    const busy: Interval[] = [{ start: H(10), end: H(10, 30) + 10 }]; // booking 10:00–10:30 + 10 min buffer already included by the caller
    const r = classifySlots({ windows: [W(H(9), H(12))], durationMinutes: 30, step: 30, buffer: 10, busy });
    expect(r.find((x) => x.start === H(10, 30))!.status).toBe("taken"); // would start inside the booking's buffer
    expect(r.find((x) => x.start === H(9, 30))!.status).toBe("taken"); // would need its own buffer after, colliding at 10:00
    expect(r.find((x) => x.start === H(9))!.status).toBe("free");
    expect(r.find((x) => x.start === H(11))!.status).toBe("free");
  });

  it("past times today are unavailable, not 'taken'", () => {
    const r = classifySlots({ windows: [W(H(9), H(12))], durationMinutes: 30, step: 30, buffer: 0, busy: [], nowMinutes: H(10) });
    expect(r.filter((x) => x.status === "unavailable").map((x) => x.start)).toEqual([H(9), H(9, 30), H(10)]);
    expect(r.find((x) => x.start === H(10, 30))!.status).toBe("free");
  });

  it("group sessions stay bookable while capacity remains (ignore hook)", () => {
    const busy: Interval[] = [{ start: H(17, 45), end: H(18, 30) }]; // sessions start every 45 min from the window start
    const open = classifySlots({ windows: [W(H(17), H(19))], durationMinutes: 45, step: 45, buffer: 0, busy, ignore: (iv, start) => iv.start === start });
    expect(open.find((x) => x.start === H(17, 45))!.status).toBe("free");
    const full = classifySlots({ windows: [W(H(17), H(19))], durationMinutes: 45, step: 45, buffer: 0, busy });
    expect(full.find((x) => x.start === H(17, 45))!.status).toBe("taken");
  });

  it("no windows → no slots (closed day)", () => {
    expect(classifySlots({ windows: [], durationMinutes: 30, step: 30, buffer: 0, busy: [] })).toEqual([]);
  });
});

describe("daySegments (ribbon)", () => {
  const base = { windows: [W(H(9), H(12))], durationMinutes: 30, step: 30, buffer: 0 };

  it("covers each window; free vs booked; gaps between windows are closed", () => {
    const segs = daySegments({ ...base, windows: [W(H(9), H(10)), W(H(11), H(12))], busy: [{ start: H(9, 30), end: H(10) }] });
    expect(segs).toEqual([
      { start: H(9), end: H(9, 30), state: "free" },
      { start: H(9, 30), end: H(10), state: "booked" },
      { start: H(10), end: H(11), state: "closed" },
      { start: H(11), end: H(12), state: "free" },
    ]);
  });

  it("merges adjacent cells of the same state", () => {
    const segs = daySegments({ ...base, busy: [] });
    expect(segs).toEqual([{ start: H(9), end: H(12), state: "free" }]);
  });

  it("marks the chosen slot as selected for the service duration", () => {
    const segs = daySegments({ ...base, durationMinutes: 60, busy: [], selectedStart: H(10) });
    expect(segs).toEqual([
      { start: H(9), end: H(10), state: "free" },
      { start: H(10), end: H(11), state: "selected" },
      { start: H(11), end: H(12), state: "free" },
    ]);
  });

  it("a long service does not show unusable pockets as free", () => {
    // 90-minute service, 30-minute step, window 9–11: only the 9:00 and 9:30 starts fit, together covering 9:00–11:00
    const segs = daySegments({ windows: [W(H(9), H(11))], durationMinutes: 90, step: 30, buffer: 0, busy: [{ start: H(9, 30), end: H(10) }] });
    expect(segs).toEqual([{ start: H(9), end: H(11), state: "booked" }]);
  });

  it("past time is closed", () => {
    const segs = daySegments({ ...base, busy: [], nowMinutes: H(10) });
    expect(segs[0]).toEqual({ start: H(9), end: H(10, 30), state: "closed" });
  });

  it("segments never overlap and stay inside the windows", () => {
    const segs = daySegments({ ...base, windows: [W(H(6), H(8)), W(H(17), H(19))], busy: [{ start: H(17), end: H(18) }], selectedStart: H(7) });
    for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBeGreaterThanOrEqual(segs[i - 1].end);
    expect(segs[0].start).toBe(H(6));
    expect(segs.at(-1)!.end).toBe(H(19));
  });
});

describe("allow (restricting offered start times)", () => {
  it("marks disallowed starts unavailable, not taken, and keeps them out of the ribbon's free cells", () => {
    const base = { windows: [{ from: 600, to: 720 }], durationMinutes: 60, step: 60, buffer: 0, busy: [] };
    const r = classifySlots({ ...base, allow: (s) => s === 660 });
    expect(r).toEqual([{ start: 600, status: "unavailable" }, { start: 660, status: "free" }]);
    const seg = daySegments({ ...base, allow: (s) => s === 660 });
    expect(seg.find((x) => x.state === "free")).toMatchObject({ start: 660, end: 720 });
  });
});

