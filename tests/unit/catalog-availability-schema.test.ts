import { describe, expect, it } from "vitest";
import { kindHours } from "@/lib/lab/onboarding";
import { ExceptionInput, WeeklyHoursInput, exceptionToRow, rowsToExceptions, rowsToRules, rulesToDayHours } from "@/modules/availability/schema";
import { mapCatalogError, ServiceInput, toCents } from "@/modules/catalog/schema";

describe("ServiceInput (CAT-01..04)", () => {
  const ok = { name: "תספורת", durationMinutes: 30, priceNis: 80 };
  it("accepts a valid service and fills defaults", () => {
    expect(ServiceInput.parse(ok)).toMatchObject({ description: "", bufferMinutes: 0, capacity: 1 });
  });
  it.each([
    ["short name", { name: "א" }],
    ["long name", { name: "א".repeat(81) }],
    ["duration < 5", { durationMinutes: 4 }],
    ["duration > 480", { durationMinutes: 481 }],
    ["fractional duration", { durationMinutes: 30.5 }],
    ["negative price", { priceNis: -1 }],
    ["absurd price", { priceNis: 1_000_000 }],
    ["buffer > 120", { bufferMinutes: 121 }],
    ["capacity 0", { capacity: 0 }],
    ["unknown field (tenant id)", { business_id: "x" }],
    ["bad uuid", { id: "not-a-uuid" }],
  ])("rejects %s", (_n, patch) => expect(ServiceInput.safeParse({ ...ok, ...patch }).success).toBe(false));
  it("converts shekels to integer agorot without float drift", () => {
    expect(toCents(80)).toBe(8000);
    expect(toCents(19.9)).toBe(1990);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
  it("maps database errors to stable codes", () => {
    expect(mapCatalogError({ code: "23505" })).toBe("DUPLICATE");
    expect(mapCatalogError({ code: "23514" })).toBe("VALIDATION");
    expect(mapCatalogError({ code: "42501" })).toBe("FORBIDDEN");
    expect(mapCatalogError({ code: "XX000", message: "relation secret" })).toBe("INTERNAL");
  });
});

describe("WeeklyHoursInput / ExceptionInput (AVL)", () => {
  it("accepts the kind defaults for every kind", () => {
    for (const k of ["barber", "beauty", "trainer", "teacher", "clinic", "other"] as const) expect(WeeklyHoursInput.safeParse(kindHours(k)).success, k).toBe(true);
  });
  it("rejects all-closed, overlap, inversion and wrong length", () => {
    const h = kindHours("barber");
    expect(WeeklyHoursInput.safeParse(h.map((d) => ({ ...d, open: false }))).success).toBe(false);
    expect(WeeklyHoursInput.safeParse(h.map((d, i) => (i === 0 ? { ...d, windows: [{ from: "09:00", to: "12:00" }, { from: "11:00", to: "14:00" }] } : d))).success).toBe(false);
    expect(WeeklyHoursInput.safeParse(h.map((d, i) => (i === 0 ? { ...d, windows: [{ from: "12:00", to: "09:00" }] } : d))).success).toBe(false);
    expect(WeeklyHoursInput.safeParse(h.slice(0, 6)).success).toBe(false);
  });
  it("exceptions: whole-day closure, partial closure and special opening are valid; incomplete ranges are not", () => {
    expect(ExceptionInput.safeParse({ date: "2026-10-20", kind: "closed" }).success).toBe(true);
    expect(ExceptionInput.safeParse({ date: "2026-10-20", kind: "closed", from: "10:00", to: "12:00" }).success).toBe(true);
    expect(ExceptionInput.safeParse({ date: "2026-10-24", kind: "open", from: "10:00", to: "14:00" }).success).toBe(true);
    expect(ExceptionInput.safeParse({ date: "2026-10-24", kind: "open" }).success).toBe(false);
    expect(ExceptionInput.safeParse({ date: "2026-10-24", kind: "closed", from: "10:00" }).success).toBe(false);
    expect(ExceptionInput.safeParse({ date: "2026-10-24", kind: "closed", from: "14:00", to: "10:00" }).success).toBe(false);
    expect(ExceptionInput.safeParse({ date: "20/10/2026", kind: "closed" }).success).toBe(false);
    expect(ExceptionInput.safeParse({ date: "2026-10-20", kind: "closed", businessId: "x" }).success).toBe(false);
  });
  it("row mappers round-trip", () => {
    const rows = [{ weekday: 0, start_minute: 360, end_minute: 600 }, { weekday: 0, start_minute: 1020, end_minute: 1260 }, { weekday: 2, start_minute: 540, end_minute: 1080 }];
    const days = rulesToDayHours(rows);
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ weekday: 0, open: true, windows: [{ from: "06:00", to: "10:00" }, { from: "17:00", to: "21:00" }] });
    expect(days[1].open).toBe(false); // closed day keeps a default window to toggle on
    expect(rowsToRules(rows)[2]).toEqual({ weekday: 2, startMinute: 540, endMinute: 1080 });
    const ex = rowsToExceptions([{ id: "x", on_date: "2026-10-20", kind: "closed", start_minute: null, end_minute: null, note: null }]);
    expect(ex).toEqual([{ date: "2026-10-20", kind: "closed", startMinute: null, endMinute: null }]);
    expect(exceptionToRow(ExceptionInput.parse({ date: "2026-10-24", kind: "open", from: "10:30", to: "14:00" }))).toMatchObject({ start_minute: 630, end_minute: 840 });
  });
});
