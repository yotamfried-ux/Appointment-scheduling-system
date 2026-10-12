import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BOM, csvCell, csvRow } from "@/modules/reports/csv";
import { daysBetween, formatMoney, formatPercent, resolvePeriod, summarize, type ReportRow } from "@/modules/reports/metrics";

// The same hand-checked dataset as the database test (070): the SQL groups, this module defines the numbers.
const rows: ReportRow[] = [
  { date: "2026-03-25", service: "תספורת", status: "completed", n: 1, cents: 8000 },
  { date: "2026-03-25", service: "צבע", status: "completed", n: 1, cents: 20000 },
  { date: "2026-03-26", service: "תספורת", status: "completed", n: 1, cents: 8000 },
  { date: "2026-03-27", service: "תספורת", status: "no_show", n: 1, cents: 8000 },
  { date: "2026-03-27", service: "תספורת", status: "cancelled_by_customer", n: 1, cents: 8000 },
  { date: "2026-03-27", service: "תספורת", status: "cancelled_by_business", n: 1, cents: 8000 },
  { date: "2026-03-28", service: "תספורת", status: "completed", n: 1, cents: 8000 },
  { date: "2026-03-28", service: "צבע", status: "confirmed", n: 1, cents: 20000 },
  { date: "2026-03-29", service: "תספורת", status: "pending", n: 1, cents: 8000 },
  { date: "2026-03-31", service: "תספורת", status: "completed", n: 1, cents: 8000 },
];
const range = { from: "2026-03-25", to: "2026-03-31" };
const s = summarize(rows, range, { newCustomers: 3, returningCustomers: 1 });

describe("metric definitions (RPT-06)", () => {
  it("counts booked appointments without pending and cancelled ones", () => expect(s.kpis.appointments).toBe(7)); // 5 completed + 1 no-show + 1 confirmed
  it("revenue is completed visits only", () => expect(s.kpis.revenueCents).toBe(52000));
  it("expected revenue is booked but not yet closed out", () => expect(s.kpis.expectedCents).toBe(20000));
  it("no-show rate: no-shows over visits with a known outcome", () => expect(s.kpis.noShowRate).toBeCloseTo(1 / 6, 10));
  it("cancellation rate: cancelled over cancelled + booked (pending excluded)", () => expect(s.kpis.cancellationRate).toBeCloseTo(2 / 9, 10));
  it("average ticket is revenue per completed visit", () => expect(s.kpis.avgTicketCents).toBe(10400));
  it("passes the customer split through", () => expect([s.kpis.newCustomers, s.kpis.returningCustomers]).toEqual([3, 1]));
  it("pending and the other counters", () => expect([s.kpis.pending, s.kpis.completed, s.kpis.noShows, s.kpis.cancelled]).toEqual([1, 5, 1, 2]));
});

describe("series", () => {
  it("zero-fills every day of the range, including a day with nothing", () => {
    expect(s.byDay.map((d) => d.date)).toEqual(["2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"]);
    expect(s.byDay.find((d) => d.date === "2026-03-30")).toEqual({ date: "2026-03-30", appointments: 0, revenueCents: 0, cancelled: 0, noShows: 0 });
  });
  it("per-day numbers add up to the totals", () => {
    expect(s.byDay.reduce((a, d) => a + d.appointments, 0)).toBe(s.kpis.appointments);
    expect(s.byDay.reduce((a, d) => a + d.revenueCents, 0)).toBe(s.kpis.revenueCents);
    expect(s.byDay.reduce((a, d) => a + d.cancelled, 0)).toBe(s.kpis.cancelled);
    expect(s.byDay.reduce((a, d) => a + d.noShows, 0)).toBe(s.kpis.noShows);
  });
  it("per-service numbers add up to the totals, sorted by revenue", () => {
    // תספורת completed revenue is 32000 cents, צבע is 20000 → תספורת first.
    expect(s.byService.map((x) => x.service)).toEqual(["תספורת", "צבע"]);
    expect(s.byService.reduce((a, x) => a + x.appointments, 0)).toBe(s.kpis.appointments);
    expect(s.byService.reduce((a, x) => a + x.revenueCents, 0)).toBe(s.kpis.revenueCents);
  });
  it("weekday distribution counts booked appointments only", () => {
    expect(s.byWeekday.reduce((a, b) => a + b, 0)).toBe(s.kpis.appointments);
    expect(s.byWeekday[3]).toBe(2); // 25 March 2026 is a Wednesday: the two visits that day
  });
  it("rows outside the range are ignored", () => {
    const out = summarize([...rows, { date: "2026-04-01", service: "תספורת", status: "completed", n: 9, cents: 99999 }], range, { newCustomers: 0, returningCustomers: 0 });
    expect(out.kpis.revenueCents).toBe(52000);
  });
});

describe("empty and degenerate input (RPT-05)", () => {
  const e = summarize([], range, { newCustomers: 0, returningCustomers: 0 });
  it("an empty period is all zeros with null ratios, never NaN", () => {
    expect(e.kpis).toMatchObject({ appointments: 0, revenueCents: 0, noShowRate: null, cancellationRate: null, avgTicketCents: null });
    expect(e.byDay).toHaveLength(7);
    expect(e.byService).toEqual([]);
  });
  it("only cancellations: rate is 100%, no-show rate undefined", () => {
    const c = summarize([{ date: "2026-03-25", service: "x", status: "cancelled_by_customer", n: 4, cents: 0 }], range, { newCustomers: 0, returningCustomers: 0 });
    expect(c.kpis.cancellationRate).toBe(1);
    expect(c.kpis.noShowRate).toBeNull();
  });
});

describe("calendar days and periods", () => {
  it("daysBetween never skips or repeats a day across the DST change", () => {
    const d = daysBetween("2026-03-25", "2026-03-30");
    expect(d).toEqual(["2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30"]);
    expect(daysBetween("2026-10-23", "2026-10-27")).toHaveLength(5); // the autumn change
    expect(daysBetween("2026-03-31", "2026-03-31")).toEqual(["2026-03-31"]);
    expect(daysBetween("2026-03-31", "2026-03-30")).toEqual([]);
  });
  it("property: n consecutive days, strictly increasing, whatever the start", () => {
    fc.assert(fc.property(fc.date({ min: new Date("2024-01-01"), max: new Date("2030-12-31"), noInvalidDate: true }), fc.integer({ min: 0, max: 400 }), (start, n) => {
      const from = start.toISOString().slice(0, 10);
      const to = new Date(Date.parse(`${from}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
      const d = daysBetween(from, to);
      expect(d).toHaveLength(n + 1);
      for (let i = 1; i < d.length; i++) expect(d[i] > d[i - 1]).toBe(true);
    }));
  });
  it("presets", () => {
    expect(resolvePeriod("2026-10-12", "7d")).toEqual({ from: "2026-10-06", to: "2026-10-12" });
    expect(resolvePeriod("2026-10-12", "30d")).toEqual({ from: "2026-09-13", to: "2026-10-12" });
    expect(resolvePeriod("2026-10-12", "month")).toEqual({ from: "2026-10-01", to: "2026-10-12" });
    expect(resolvePeriod("2026-10-12", "lastMonth")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolvePeriod("2026-01-05", "lastMonth")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(resolvePeriod("2028-03-10", "lastMonth")).toEqual({ from: "2028-02-01", to: "2028-02-29" }); // leap year
  });
});

describe("formatting", () => {
  it("money and percent", () => {
    expect(formatMoney(52000)).toContain("520");
    expect(formatMoney(8050)).toContain("80.50");
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(1 / 6)).toBe("16.7%");
    expect(formatPercent(0.5)).toBe("50%");
    expect(formatPercent(0)).toBe("0%");
  });
});

describe("CSV for Excel (RPT-02/03)", () => {
  it("has a BOM constant and quotes every field, doubling quotes", () => {
    expect(BOM).toBe("﻿");
    expect(csvCell('דנה "הגדולה"')).toBe('"דנה ""הגדולה"""');
    expect(csvRow(["a", 1, null])).toBe('"a",1,""\r\n');
  });
  it.each(["=SUM(A1)", "+972501234567", "-1+1", "@cmd", "\tx", "\rx", "=cmd|' /C calc'!A0", "=HYPERLINK(\"http://evil\")"])("neutralises %j", (v) => {
    expect(csvCell(v).startsWith(`"'`)).toBe(true);
  });
  it("leaves ordinary text alone, and real numbers are not formulas", () => {
    expect(csvCell("שלום")).toBe('"שלום"');
    expect(csvCell("a=b")).toBe('"a=b"');
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(Number.NaN)).toBe('""');
  });
  it("property: no cell can start a formula, and a row always has the right number of fields", () => {
    fc.assert(fc.property(fc.array(fc.string(), { minLength: 1, maxLength: 8 }), (cells) => {
      const row = csvRow(cells);
      expect(row.endsWith("\r\n")).toBe(true);
      for (const c of cells) {
        const out = csvCell(c);
        expect(out.startsWith('"')).toBe(true);
        expect(/^"[=+\-@\t\r]/.test(out)).toBe(false);
      }
    }));
  });
});
