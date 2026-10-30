// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("public availability contract (Section 5.1 & BKG-11)", () => {
  it("when acceptingBookings is false, computeAvailability throws BOOKINGS_CLOSED (HTTP 409)", async () => {
    const { computeAvailability } = await import("@/modules/booking/public/service");
    const catalog = {
      business: {
        id: "00000000-0000-4000-a002-000000000001",
        slug: "test-biz",
        name: "עסק בדיקה",
        kind: "barber" as const,
        timezone: "Asia/Jerusalem",
        address: "תל אביב",
        requiresApproval: false,
        cancelUntilHours: 2,
        minNoticeMinutes: 60,
        horizonDays: 30,
        waitlistEnabled: true,
        acceptingBookings: false,
      },
      services: [{
        id: "00000000-0000-4000-a004-000000000001",
        name: "תספורת",
        description: "",
        durationMinutes: 30,
        bufferMinutes: 0,
        priceCents: 8000,
        priceMode: "fixed" as const,
        requiresApproval: null,
        staffIds: null,
      }],
      team: [{ id: "00000000-0000-4000-a003-000000000001", name: "ספר" }],
      rules: [{ resourceId: "00000000-0000-4000-a003-000000000001", weekday: 0, startMinute: 540, endMinute: 1020 }],
      exceptions: [],
    };
    try {
      await computeAvailability(catalog as never, catalog.services[0].id, "2026-11-01", 7, undefined, []);
      expect.fail("should have thrown 409 BOOKINGS_CLOSED");
    } catch (e) {
      const err = e as { code: string; status: number };
      expect(err.code).toBe("BOOKINGS_CLOSED");
      expect(err.status).toBe(409);
    }
  });

  it("when acceptingBookings is true, computeAvailability returns 200 OK with free slots", async () => {
    const { computeAvailability } = await import("@/modules/booking/public/service");
    const catalog = {
      business: {
        id: "00000000-0000-4000-a002-000000000001",
        slug: "test-biz",
        name: "עסק בדיקה",
        kind: "barber" as const,
        timezone: "Asia/Jerusalem",
        address: "תל אביב",
        requiresApproval: false,
        cancelUntilHours: 2,
        minNoticeMinutes: 60,
        horizonDays: 30,
        waitlistEnabled: true,
        acceptingBookings: true,
      },
      services: [{
        id: "00000000-0000-4000-a004-000000000001",
        name: "תספורת",
        description: "",
        durationMinutes: 30,
        bufferMinutes: 0,
        priceCents: 8000,
        priceMode: "fixed" as const,
        requiresApproval: null,
        staffIds: null,
      }],
      team: [{ id: "00000000-0000-4000-a003-000000000001", name: "ספר" }],
      rules: [{ resourceId: "00000000-0000-4000-a003-000000000001", weekday: 0, startMinute: 540, endMinute: 1020 }],
      exceptions: [],
    };
    const res = await computeAvailability(catalog as never, catalog.services[0].id, "2026-11-01", 7, undefined, []);
    expect(res.days).toHaveLength(7);
    expect(res.days[0].closed).toBe(false);
    expect(res.days[0].freeSlots).toBeGreaterThan(0);
  });
});
