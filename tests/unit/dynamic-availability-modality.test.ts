import { describe, expect, it } from "vitest";
import {
  addWindow,
  DEFAULT_HOURS,
  hoursValid,
  isValidHHmm,
  pickNextNonOverlappingWindow,
  setWindow,
  windowDurationMinutes,
  windowProblem,
  windowShorterThanService,
  windowsValid,
} from "@/lib/lab/onboarding";
import { ExceptionInput, MAX_WINDOWS_PER_DAY, WeeklyHoursInput } from "@/modules/availability/schema";
import { slotsForDay } from "@/modules/availability/slots";
import { teamSlotsForDay } from "@/modules/availability/team";
import { ServiceInput } from "@/modules/catalog/schema";
import { CreateBookingRequest } from "@/lib/api/contracts";
import { LEGAL } from "@/lib/legal/config";
import { formatModalityLabel } from "@/components/patterns/modality-badge";
import { render, type NotifContext } from "@/modules/notifications/templates";

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const withWeekdayWindows = (weekday: number, windows: { from: string; to: string }[]) =>
  DEFAULT_HOURS.map((h) => (h.weekday === weekday ? { ...h, open: true, windows } : h));

describe("FEATURE-01: Unlimited Availability Intervals (TEST-A)", () => {
  it("supports 5, 6, 20, and 50 non-overlapping intervals in a single day without artificial caps", () => {
    expect(MAX_WINDOWS_PER_DAY).toBeGreaterThanOrEqual(50);

    // 6 single-lesson windows in one day (exact user example)
    const sixWindows = [
      { from: "08:00", to: "09:00" },
      { from: "10:15", to: "11:15" },
      { from: "13:00", to: "14:00" },
      { from: "16:30", to: "17:30" },
      { from: "19:00", to: "20:00" },
      { from: "20:30", to: "21:30" },
    ];
    expect(windowsValid(sixWindows)).toBe(true);
    expect(WeeklyHoursInput.safeParse(withWeekdayWindows(0, sixWindows)).success).toBe(true);

    // 20 and 50 intervals in a single day
    const makeIntervals = (count: number) =>
      Array.from({ length: count }, (_, i) => {
        const startMin = i * 20;
        const endMin = startMin + 15;
        return { from: fromMinutes(startMin), to: fromMinutes(endMin) };
      });

    const twentyWindows = makeIntervals(20);
    expect(windowsValid(twentyWindows)).toBe(true);
    expect(WeeklyHoursInput.safeParse(withWeekdayWindows(1, twentyWindows)).success).toBe(true);

    const fiftyWindows = makeIntervals(50);
    expect(windowsValid(fiftyWindows)).toBe(true);
    expect(WeeklyHoursInput.safeParse(withWeekdayWindows(2, fiftyWindows)).success).toBe(true);
  });

  it("addWindow helper adds 10+ windows sequentially without stopping at 3", () => {
    let hours = DEFAULT_HOURS.map((h, idx) =>
      idx === 0 ? { ...h, open: true, windows: [{ from: "06:00", to: "07:00" }] } : h,
    );
    for (let i = 0; i < 9; i++) {
      hours = addWindow(hours, 0);
    }
    expect(hours[0].windows).toHaveLength(10);
    expect(hoursValid(hours)).toBe(true);
  });

  it("pickNextNonOverlappingWindow returns null when the 24h day is full, and addWindow is a safe no-op", () => {
    // Case 1: A single 24-hour window covering 00:00 to 24:00
    const fullDaySingle = [{ from: "00:00", to: "24:00" }];
    expect(pickNextNonOverlappingWindow(fullDaySingle)).toBeNull();

    let hoursFull = DEFAULT_HOURS.map((h, idx) =>
      idx === 0 ? { ...h, open: true, windows: fullDaySingle } : h,
    );
    const beforeLength = hoursFull[0].windows.length;
    hoursFull = addWindow(hoursFull, 0);
    expect(hoursFull[0].windows).toHaveLength(beforeLength);
    expect(hoursFull[0].windows).toEqual(fullDaySingle);

    // Case 2: Contiguous multiple windows spanning the entire 24h day
    const fullDayMultiple = [
      { from: "00:00", to: "08:00" },
      { from: "08:00", to: "16:00" },
      { from: "16:00", to: "24:00" },
    ];
    expect(pickNextNonOverlappingWindow(fullDayMultiple)).toBeNull();

    // Case 3: Shortening a full day window frees up space, allowing a new non-overlapping window
    const shortened = [{ from: "00:00", to: "20:00" }];
    const nextWindow = pickNextNonOverlappingWindow(shortened);
    expect(nextWindow).not.toBeNull();
    expect(toMinutes(nextWindow!.from)).toBeGreaterThanOrEqual(toMinutes("20:00"));
    expect(toMinutes(nextWindow!.to)).toBeLessThanOrEqual(toMinutes("24:00"));

    let hoursShortened = DEFAULT_HOURS.map((h, idx) =>
      idx === 0 ? { ...h, open: true, windows: shortened } : h,
    );
    hoursShortened = addWindow(hoursShortened, 0);
    expect(hoursShortened[0].windows).toHaveLength(2);
    expect(windowsValid(hoursShortened[0].windows)).toBe(true);
  });

  it("single-lesson windows generate exact slots matching each window start and nothing outside", () => {
    const rules = [
      { weekday: 3, startMinute: toMinutes("08:00"), endMinute: toMinutes("09:00") },
      { weekday: 3, startMinute: toMinutes("10:15"), endMinute: toMinutes("11:15") },
      { weekday: 3, startMinute: toMinutes("13:00"), endMinute: toMinutes("14:00") },
      { weekday: 3, startMinute: toMinutes("16:30"), endMinute: toMinutes("17:30") },
      { weekday: 3, startMinute: toMinutes("19:00"), endMinute: toMinutes("20:00") },
      { weekday: 3, startMinute: toMinutes("20:30"), endMinute: toMinutes("21:30") },
    ];
    // 2026-10-14 is a Wednesday (weekday 3)
    const slots = slotsForDay({
      date: "2026-10-14",
      rules,
      exceptions: [],
      busy: [],
      durationMinutes: 60,
      bufferMinutes: 0,
      stepMinutes: 30,
      timeZone: "Asia/Jerusalem",
      now: new Date("2026-10-10T08:00:00Z"),
    });
    expect(slots.map((s) => s.local)).toEqual(["08:00", "10:15", "13:00", "16:30", "19:00", "20:30"]);
  });

  it("supports independent unlimited windows per staff member in teamSlotsForDay", () => {
    const people = [
      { id: "p1", name: "דנה" },
      { id: "p2", name: "נועם" },
    ];
    const rules = [
      { resourceId: "p1", weekday: 3, startMinute: toMinutes("08:10"), endMinute: toMinutes("09:10") },
      { resourceId: "p1", weekday: 3, startMinute: toMinutes("10:15"), endMinute: toMinutes("11:15") },
      { resourceId: "p1", weekday: 3, startMinute: toMinutes("12:20"), endMinute: toMinutes("13:20") },
      { resourceId: "p1", weekday: 3, startMinute: toMinutes("15:05"), endMinute: toMinutes("16:05") },
      { resourceId: "p2", weekday: 3, startMinute: toMinutes("09:45"), endMinute: toMinutes("10:45") },
    ];
    const p1Slots = teamSlotsForDay({
      date: "2026-10-14",
      people: [people[0]],
      rules,
      exceptions: [],
      busy: [],
      durationMinutes: 60,
      bufferMinutes: 0,
      stepMinutes: 30,
      timeZone: "Asia/Jerusalem",
      now: new Date("2026-10-10T08:00:00Z"),
    });
    expect(p1Slots.map((s) => s.local)).toEqual(["08:10", "10:15", "12:20", "15:05"]);

    const p2Slots = teamSlotsForDay({
      date: "2026-10-14",
      people: [people[1]],
      rules,
      exceptions: [],
      busy: [],
      durationMinutes: 60,
      bufferMinutes: 0,
      stepMinutes: 30,
      timeZone: "Asia/Jerusalem",
      now: new Date("2026-10-10T08:00:00Z"),
    });
    expect(p2Slots.map((s) => s.local)).toEqual(["09:45"]);
  });
});

describe("FEATURE-02: Flexible Manual Time Selection & Duration Awareness (TEST-B & TEST-C)", () => {
  it("accepts non-round manual HH:MM times without rounding or rejecting", () => {
    const manualWindows = [
      { from: "06:17", to: "07:22" },
      { from: "09:05", to: "10:35" },
      { from: "10:45", to: "11:45" },
      { from: "22:10", to: "23:40" },
    ];
    expect(windowsValid(manualWindows)).toBe(true);
    const parsed = WeeklyHoursInput.safeParse(withWeekdayWindows(0, manualWindows));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data[0].windows).toEqual(manualWindows);
    }

    // Exceptions also accept arbitrary manual minutes
    const exc = ExceptionInput.safeParse({
      date: "2026-11-15",
      kind: "open",
      from: "09:05",
      to: "10:35",
      note: "שעות מיוחדות",
    });
    expect(exc.success).toBe(true);
  });

  it("supports end-of-day boundary times (23:59 and 24:00) and rejects invalid formats (TEST-C)", () => {
    expect(isValidHHmm("00:00")).toBe(true);
    expect(isValidHHmm("23:59")).toBe(true);
    expect(isValidHHmm("24:00", true)).toBe(true);
    expect(isValidHHmm("24:00", false)).toBe(false);
    expect(isValidHHmm("25:00", true)).toBe(false);
    expect(isValidHHmm("12:99", true)).toBe(false);
    expect(isValidHHmm("abc", true)).toBe(false);

    expect(windowsValid([{ from: "22:15", to: "23:59" }])).toBe(true);
    expect(windowsValid([{ from: "22:15", to: "24:00" }])).toBe(true);
    expect(windowsValid([{ from: "25:00", to: "26:00" }])).toBe(false);
    expect(windowProblem([{ from: "12:99", to: "14:00" }], 0)).toBe("format");
  });

  it("rejects overlapping or inverted intervals and allows touching intervals (TEST-C)", () => {
    // Overlap rejected
    expect(windowsValid([{ from: "10:00", to: "11:00" }, { from: "10:30", to: "11:30" }])).toBe(false);
    expect(windowProblem([{ from: "10:00", to: "11:00" }, { from: "10:30", to: "11:30" }], 1)).toBe("overlap");
    expect(
      WeeklyHoursInput.safeParse(withWeekdayWindows(0, [{ from: "10:00", to: "11:00" }, { from: "10:30", to: "11:30" }])).success,
    ).toBe(false);

    // Touching intervals allowed
    expect(windowsValid([{ from: "10:00", to: "11:00" }, { from: "11:00", to: "12:00" }])).toBe(true);
    expect(
      WeeklyHoursInput.safeParse(withWeekdayWindows(0, [{ from: "10:00", to: "11:00" }, { from: "11:00", to: "12:00" }])).success,
    ).toBe(true);

    // Inverted window rejected
    expect(windowsValid([{ from: "11:00", to: "10:00" }])).toBe(false);
    expect(windowProblem([{ from: "11:00", to: "10:00" }], 0)).toBe("order");
    expect(windowsValid([{ from: "10:00", to: "10:00" }])).toBe(false);
  });

  it("detects when a window is shorter than the service duration and generates 0 invalid slots (TEST-B)", () => {
    const shortWindow = { from: "10:15", to: "10:45" };
    expect(windowDurationMinutes(shortWindow)).toBe(30);
    expect(windowShorterThanService(shortWindow, 60)).toBe(true);
    expect(windowShorterThanService({ from: "10:15", to: "11:15" }, 60)).toBe(false);

    // Engine does not generate a 60-minute slot inside a 30-minute window
    const slots = slotsForDay({
      date: "2026-10-14",
      rules: [{ weekday: 3, startMinute: toMinutes("10:15"), endMinute: toMinutes("10:45") }],
      exceptions: [],
      busy: [],
      durationMinutes: 60,
      bufferMinutes: 0,
      stepMinutes: 30,
      timeZone: "Asia/Jerusalem",
      now: new Date("2026-10-10T08:00:00Z"),
    });
    expect(slots).toEqual([]);
  });

  it("setWindow preserves custom minute strings exactly", () => {
    const updated = setWindow(DEFAULT_HOURS, 0, 0, "06:17", "07:22");
    expect(updated[0].windows[0]).toEqual({ from: "06:17", to: "07:22" });
  });
});

describe("FEATURE-03: Appointment Modality (Online vs. Frontal) (TEST-E, TEST-F, TEST-G)", () => {
  it("validates service-level modality options (Online only, Frontal only, Both)", () => {
    const onlineOnly = ServiceInput.safeParse({
      name: "ייעוץ זום",
      durationMinutes: 45,
      bufferMinutes: 0,
      priceNis: 200,
      locations: ["online"],
    });
    expect(onlineOnly.success).toBe(true);

    const frontalOnly = ServiceInput.safeParse({
      name: "שיעור פרונטלי",
      durationMinutes: 60,
      bufferMinutes: 0,
      priceNis: 180,
      locations: ["business"],
    });
    expect(frontalOnly.success).toBe(true);

    const hybrid = ServiceInput.safeParse({
      name: "שיעור גמיש",
      durationMinutes: 60,
      bufferMinutes: 0,
      priceNis: 180,
      locations: ["business", "online"],
    });
    expect(hybrid.success).toBe(true);

    const emptyLocations = ServiceInput.safeParse({
      name: "שגוי",
      durationMinutes: 60,
      bufferMinutes: 0,
      priceNis: 180,
      locations: [],
    });
    expect(emptyLocations.success).toBe(false);
  });

  it("allows CreateBookingRequest with explicit or omitted location (for single-modality auto-selection)", () => {
    const withOnline = CreateBookingRequest.safeParse({
      serviceId: "s1",
      date: "2026-10-14",
      time: "10:15",
      customer: { fullName: "דנה כהן", phone: "0501234567", email: "dana@example.com" },
      location: "online",
      intake: {},
      acceptedTerms: { terms: LEGAL.terms.version, privacy: LEGAL.privacy.version },
    });
    expect(withOnline.success).toBe(true);

    const omittedForAutoSelect = CreateBookingRequest.safeParse({
      serviceId: "s1",
      date: "2026-10-14",
      time: "10:15",
      customer: { fullName: "דנה כהן", phone: "0501234567", email: "dana@example.com" },
      intake: {},
      acceptedTerms: { terms: LEGAL.terms.version, privacy: LEGAL.privacy.version },
    });
    expect(omittedForAutoSelect.success).toBe(true);
  });

  it("formats modality labels and renders clear modality row in customer and owner notification emails", () => {
    expect(formatModalityLabel("online")).toBe("אונליין");
    expect(formatModalityLabel("business")).toBe("פרונטלי");
    expect(formatModalityLabel("customer")).toBe("פרונטלי (אצל הלקוח)");

    const baseCtx: NotifContext = {
      type: "owner_new_request",
      recipient: "owner",
      appointment: {
        id: "a1",
        status: "pending",
        startsAt: "2026-10-14T07:15:00Z",
        endsAt: "2026-10-14T08:15:00Z",
        reference: "TR-MOD1",
        serviceName: "שיעור פרטי",
        location: "online",
      },
      offer: null,
      business: { name: "סטודיו אלפא", slug: "alpha", kind: "teacher", timezone: "Asia/Jerusalem", phone: "+972501234567" },
      customer: { name: "נועם לוי", email: "noam@example.com" },
      owner: { email: "owner@example.com" },
    };

    const onlineMail = render(baseCtx, { appUrl: "https://turim.d2ryf.com" });
    expect(onlineMail.text).toContain("אופן מפגש: אונליין");
    expect(onlineMail.html).toContain("אופן מפגש");
    expect(onlineMail.html).toContain("אונליין");

    const frontalMail = render(
      { ...baseCtx, appointment: { ...baseCtx.appointment!, location: "business" } },
      { appUrl: "https://turim.d2ryf.com" },
    );
    expect(frontalMail.text).toContain("אופן מפגש: פרונטלי");
    expect(frontalMail.html).toContain("פרונטלי");
  });
});
