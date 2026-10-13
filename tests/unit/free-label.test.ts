import { describe, expect, it } from "vitest";
import { freeLabel } from "@/lib/lab/dashboard-data";

const t = (k: string, v: { h: number; m: number }) => ({ "stats.freeH": `${v.h} ש׳`, "stats.freeM": `${v.m} דק׳`, "stats.freeHM": `${v.h} ש׳ ${v.m} דק׳` })[k]!;
describe("freeLabel", () => {
  it("says free time in words, never as a clock (25:00)", () => {
    expect(freeLabel(1500, t as never)).toBe("25 ש׳");
    expect(freeLabel(45, t as never)).toBe("45 דק׳");
    expect(freeLabel(150, t as never)).toBe("2 ש׳ 30 דק׳");
    expect(freeLabel(0, t as never)).toBe("0 דק׳");
  });
});
