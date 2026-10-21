import { describe, expect, it } from "vitest";
import { ribbonGeometry, ribbonSummary, type RibbonSegment } from "@/lib/ribbon";

const H = (h: number, m = 0) => h * 60 + m;

describe("ribbonGeometry", () => {
  it("maps minutes to percentages of the visible range", () => {
    const g = ribbonGeometry([{ start: H(9), end: H(13.5 as number), state: "booked" }], H(9), H(18));
    expect(g).toEqual([{ start: 0, size: 50, state: "booked" }]);
  });

  it("clamps segments that stick out of the working range", () => {
    const g = ribbonGeometry([{ start: H(8), end: H(10), state: "free" }, { start: H(17), end: H(19), state: "pending" }], H(9), H(18));
    expect(g[0]).toMatchObject({ start: 0, size: (60 / 540) * 100 });
    expect(g[1].start + g[1].size).toBeCloseTo(100, 5);
  });

  it("drops empty or inverted segments and sorts by start", () => {
    const segs: RibbonSegment[] = [
      { start: H(12), end: H(13), state: "booked" },
      { start: H(10), end: H(10), state: "free" },
      { start: H(11), end: H(10), state: "free" },
      { start: H(9), end: H(10), state: "free" },
    ];
    const g = ribbonGeometry(segs, H(9), H(18));
    expect(g.map((x) => x.state)).toEqual(["free", "booked"]);
  });

  it("rejects an invalid range", () => {
    expect(() => ribbonGeometry([], H(18), H(9))).toThrow();
  });
});

describe("ribbonSummary (accessible text alternative)", () => {
  const labels = { booked: "תפוס", free: "פנוי", pending: "ממתין", closed: "סגור", selected: "נבחר" } as const;
  it("lists each state with its time ranges in order", () => {
    const text = ribbonSummary(
      [
        { start: H(9), end: H(10, 30), state: "booked" },
        { start: H(10, 30), end: H(12), state: "free" },
        { start: H(14), end: H(15), state: "free" },
      ],
      labels,
    );
    expect(text).toBe("תפוס: 09:00–10:30. פנוי: 10:30–12:00, 14:00–15:00.");
  });
  it("returns an empty string for no segments", () => {
    expect(ribbonSummary([], labels)).toBe("");
  });
});
