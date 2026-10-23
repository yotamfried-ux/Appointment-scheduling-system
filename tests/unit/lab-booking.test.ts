import { describe, expect, it } from "vitest";
import { bookingReducer, initialBookingState, canContinue } from "@/lib/lab/booking-flow";
import { formatDayLabel, formatTime, generateDays, generateSlots, LAB_SERVICES, LAB_TODAY } from "@/lib/lab/booking-data";

const svc = LAB_SERVICES[0]; // 30 minutes

describe("generateDays", () => {
  it("returns the requested number of consecutive days starting today (Asia/Jerusalem)", () => {
    const days = generateDays(LAB_TODAY, 14);
    expect(days).toHaveLength(14);
    expect(days[0].iso).toBe("2026-10-14");
    expect(days[13].iso).toBe("2026-10-27");
  });

  it("marks Saturday closed and Friday short", () => {
    const days = generateDays(LAB_TODAY, 14);
    const sat = days.find((d) => d.iso === "2026-10-17")!;
    const fri = days.find((d) => d.iso === "2026-10-16")!;
    expect(sat.closed).toBe(true);
    expect(fri.closed).toBe(false);
    expect(generateSlots(sat.iso, svc)).toEqual([]);
    expect(generateSlots(fri.iso, svc).at(-1)!.time <= "12:30").toBe(true);
  });
});

describe("generateSlots", () => {
  it("never offers a slot that would overrun closing time (BKG-15)", () => {
    const long = LAB_SERVICES.find((s) => s.durationMinutes >= 60)!;
    const slots = generateSlots("2026-10-15", long);
    const [h, m] = slots.at(-1)!.time.split(":").map(Number);
    expect(h * 60 + m + long.durationMinutes).toBeLessThanOrEqual(18 * 60);
  });

  it("is deterministic and sorted ascending", () => {
    const a = generateSlots("2026-10-15", svc);
    const b = generateSlots("2026-10-15", svc);
    expect(a).toEqual(b);
    expect([...a].map((s) => s.time)).toEqual([...a].map((s) => s.time).sort());
  });

  it("omits slots that are already taken", () => {
    const all = generateSlots("2026-10-15", svc, { includeTaken: true });
    const free = generateSlots("2026-10-15", svc);
    expect(all.some((s) => s.taken)).toBe(true);
    expect(free.every((s) => !s.taken)).toBe(true);
    expect(free.length).toBeLessThan(all.length);
  });

  it("does not offer past times on the current day", () => {
    const slots = generateSlots(LAB_TODAY, svc, { nowMinutes: 11 * 60 });
    expect(slots.every((s) => s.time >= "11:30")).toBe(true);
  });
});

describe("formatting (Hebrew, Asia/Jerusalem)", () => {
  it("formats the day label in Hebrew", () => {
    expect(formatDayLabel("2026-10-14")).toContain("רביעי");
  });
  it("formats time as 24h HH:mm", () => {
    expect(formatTime("09:05")).toBe("09:05");
  });
});

describe("bookingReducer", () => {
  it("walks service → day → time → details → done", () => {
    let s = initialBookingState;
    expect(canContinue(s)).toBe(false);
    s = bookingReducer(s, { type: "selectService", serviceId: svc.id });
    expect(s.step).toBe("service");
    expect(canContinue(s)).toBe(true);
    s = bookingReducer(s, { type: "next" });
    expect(s.step).toBe("day");
    s = bookingReducer(s, { type: "selectDay", iso: "2026-10-15" });
    s = bookingReducer(s, { type: "next" });
    expect(s.step).toBe("time");
    s = bookingReducer(s, { type: "selectTime", time: "10:00" });
    s = bookingReducer(s, { type: "next" });
    expect(s.step).toBe("details");
    expect(canContinue(s)).toBe(false);
    s = bookingReducer(s, { type: "setDetails", details: { fullName: "דנה כהן", phone: "050-1234567", email: "dana@example.com" } });
    expect(canContinue(s)).toBe(true);
    s = bookingReducer(s, { type: "next" });
    expect(s.step).toBe("done");
  });

  it("resets downstream choices when an upstream choice changes", () => {
    let s = initialBookingState;
    s = bookingReducer(s, { type: "selectService", serviceId: svc.id });
    s = bookingReducer(s, { type: "selectDay", iso: "2026-10-15" });
    s = bookingReducer(s, { type: "selectTime", time: "10:00" });
    s = bookingReducer(s, { type: "selectDay", iso: "2026-10-18" });
    expect(s.time).toBeNull();
    s = bookingReducer(s, { type: "selectTime", time: "10:30" });
    s = bookingReducer(s, { type: "selectService", serviceId: LAB_SERVICES[1].id });
    expect(s.day).toBeNull();
    expect(s.time).toBeNull();
  });

  it("back never goes before the first step and keeps choices", () => {
    let s = bookingReducer(initialBookingState, { type: "back" });
    expect(s.step).toBe("service");
    s = bookingReducer(s, { type: "selectService", serviceId: svc.id });
    s = bookingReducer(s, { type: "next" });
    s = bookingReducer(s, { type: "back" });
    expect(s.step).toBe("service");
    expect(s.serviceId).toBe(svc.id);
  });

  it("requires an e-mail address: it is how the customer is identified", () => {
    let s = initialBookingState;
    s = { ...s, step: "details", serviceId: svc.id, day: "2026-10-15", time: "10:00" };
    for (const email of ["", "  ", "dana", "dana@"]) {
      s = bookingReducer(s, { type: "setDetails", details: { fullName: "דנה", phone: "050-1234567", email } });
      expect(canContinue(s), email).toBe(false);
    }
  });

  it("requires a valid Israeli phone number and name before confirming (ACC-03)", () => {
    let s = initialBookingState;
    s = { ...s, step: "details", serviceId: svc.id, day: "2026-10-15", time: "10:00" };
    for (const phone of ["123", "050-12", "abc"]) {
      s = bookingReducer(s, { type: "setDetails", details: { fullName: "דנה", phone, email: "dana@example.com" } });
      expect(canContinue(s), phone).toBe(false);
    }
    for (const phone of ["050-1234567", "0501234567", "+972501234567", "03-5551234"]) {
      s = bookingReducer(s, { type: "setDetails", details: { fullName: "דנה", phone, email: "dana@example.com" } });
      expect(canContinue(s), phone).toBe(true);
    }
  });
});

import { dayBounds, slotSegments } from "@/lib/lab/booking-data";

describe("dayBounds / slotSegments (ribbon data for the time step)", () => {
  const svc30 = LAB_SERVICES[0];

  it("reports opening hours per weekday", () => {
    expect(dayBounds("2026-10-15")).toEqual({ from: 9 * 60, to: 18 * 60 });
    expect(dayBounds("2026-10-16")).toEqual({ from: 9 * 60, to: 13 * 60 });
    expect(dayBounds("2026-10-17")).toBeNull();
  });

  it("covers the whole day with no gaps or overlaps", () => {
    const segs = slotSegments("2026-10-15", svc30, null);
    const { from, to } = dayBounds("2026-10-15")!;
    expect(segs[0].start).toBe(from);
    expect(segs.at(-1)!.end).toBe(to);
    for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBe(segs[i - 1].end);
  });

  it("merges adjacent segments of the same state", () => {
    const segs = slotSegments("2026-10-15", svc30, null);
    for (let i = 1; i < segs.length; i++) expect(segs[i].state).not.toBe(segs[i - 1].state);
  });

  it("marks the chosen slot as selected for exactly the service duration", () => {
    const free = generateSlots("2026-10-15", svc30)[0];
    const segs = slotSegments("2026-10-15", svc30, free.time);
    const sel = segs.filter((s) => s.state === "selected");
    expect(sel).toHaveLength(1);
    expect(sel[0].end - sel[0].start).toBe(svc30.durationMinutes);
  });

  it("the person is part of the choice (stage 16): picking one clears day and time, changing the service forgets the person, 'whoever is free' is null", () => {
    let s = bookingReducer(initialBookingState, { type: "selectService", serviceId: svc.id });
    expect(s.personId).toBeNull();
    s = bookingReducer(s, { type: "selectPerson", personId: "p1" });
    s = bookingReducer(s, { type: "selectDay", iso: "2026-10-15" });
    s = bookingReducer(s, { type: "selectTime", time: "10:00" });
    s = bookingReducer(s, { type: "selectPerson", personId: null });
    expect(s.personId).toBeNull();
    expect(s.day).toBeNull(); // the offered times were the other person's
    expect(s.time).toBeNull();
    s = bookingReducer(s, { type: "selectPerson", personId: "p2" });
    s = bookingReducer(s, { type: "selectService", serviceId: LAB_SERVICES[1].id });
    expect(s.personId).toBeNull(); // the new service may not be done by that person
  });
});
