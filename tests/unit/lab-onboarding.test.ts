import { describe, expect, it } from "vitest";
import { BUSINESS_KINDS, KIND_IDS } from "@/modules/tenancy/business-kind";
import {
  canContinueOnboarding,
  initialOnboarding,
  onboardingReducer,
  suggestSlug,
  DEFAULT_HOURS,
  hoursValid,
  serviceValid,
  windowProblem,
  windowsValid,
  type OnboardingState,
} from "@/lib/lab/onboarding";

describe("suggestSlug word boundaries", () => {
  it("shortens long names at a hyphen, never mid-word", () => {
    const slug = suggestSlug("Same Name Studio With A Really Long Business Name kpxzaxqwe");
    expect(slug).toBe("same-name-studio-with-a-really-long");
    expect(slug.length).toBeLessThanOrEqual(40);
  });
  it("falls back to a hard cut for one very long word", () => {
    expect(suggestSlug("a".repeat(80))).toBe("a".repeat(40));
  });
});

describe("suggestSlug (ACC-06)", () => {
  it.each(["מספרת הדר", "Hadar's Barber & Co.", "  ***  ", "admin", "api", "ד"])("%j yields a safe, ASCII, URL-friendly slug", (name) => {
    const slug = suggestSlug(name);
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(["admin", "api", "login", "auth", "book", "app", "www"]).not.toContain(slug);
  });

  it("transliterates Hebrew deterministically", () => {
    expect(suggestSlug("מספרת הדר")).toBe(suggestSlug("מספרת הדר"));
    expect(suggestSlug("מספרת הדר")).not.toBe("");
  });

  it("keeps readable latin names", () => {
    expect(suggestSlug("Hadar Barber")).toBe("hadar-barber");
  });
});

describe("onboarding validation", () => {
  const base: OnboardingState = {
    ...initialOnboarding,
    business: { name: "מספרת הדר", type: "barber", phone: "050-1234567" },
    services: [{ id: "s1", name: "תספורת", durationMinutes: 30, priceNis: 80 }],
  };

  it("step 1 needs a name and a valid phone", () => {
    expect(canContinueOnboarding({ ...initialOnboarding })).toBe(false);
    expect(canContinueOnboarding({ ...base, step: "business", business: { ...base.business, phone: "123" } })).toBe(false);
    expect(canContinueOnboarding({ ...base, step: "business" })).toBe(true);
  });

  it("step 2 needs at least one complete service with positive duration and price", () => {
    const s = { ...base, step: "services" as const };
    expect(canContinueOnboarding(s)).toBe(true);
    expect(canContinueOnboarding({ ...s, services: [] })).toBe(false);
    expect(canContinueOnboarding({ ...s, services: [{ id: "x", name: "", durationMinutes: 30, priceNis: 80 }] })).toBe(false);
    expect(canContinueOnboarding({ ...s, services: [{ id: "x", name: "א", durationMinutes: 0, priceNis: 80 }] })).toBe(false);
  });

  it("step 3 needs at least one open day and from < to on every open day", () => {
    const s = { ...base, step: "hours" as const };
    expect(canContinueOnboarding(s)).toBe(true);
    expect(canContinueOnboarding({ ...s, hours: DEFAULT_HOURS.map((h) => ({ ...h, open: false })) })).toBe(false);
    expect(canContinueOnboarding({ ...s, hours: s.hours.map((h, i) => (i === 0 ? { ...h, windows: [{ from: "18:00", to: "09:00" }] } : h)) })).toBe(false);
  });
});

describe("onboardingReducer", () => {
  it("walks business → services → hours → done and can go back", () => {
    let s = onboardingReducer(initialOnboarding, { type: "setBusiness", business: { name: "מספרת הדר", type: "barber", phone: "0501234567" } });
    s = onboardingReducer(s, { type: "next" });
    expect(s.step).toBe("services");
    s = onboardingReducer(s, { type: "updateService", id: s.services[0].id, patch: { name: "תספורת", priceNis: 80 } });
    s = onboardingReducer(s, { type: "next" });
    expect(s.step).toBe("hours");
    s = onboardingReducer(s, { type: "next" });
    expect(s.step).toBe("done");
    expect(onboardingReducer(s, { type: "back" })).toBe(s); // done is terminal
  });

  it("does not advance an invalid step", () => {
    expect(onboardingReducer(initialOnboarding, { type: "next" })).toBe(initialOnboarding);
  });

  it("adds and removes services but never leaves the list with zero rows", () => {
    const n = initialOnboarding.services.length;
    let s = onboardingReducer(initialOnboarding, { type: "addService" });
    expect(s.services).toHaveLength(n + 1);
    for (let i = 0; i < n; i++) s = onboardingReducer(s, { type: "removeService", id: s.services[0].id });
    expect(s.services).toHaveLength(1);
    expect(onboardingReducer(s, { type: "removeService", id: s.services[0].id }).services).toHaveLength(1);
  });

  it("adding a preset creates a filled row", () => {
    const s = onboardingReducer(initialOnboarding, { type: "addService", service: { name: "עיצוב זקן", durationMinutes: 20, priceNis: 40 } });
    expect(s.services.at(-1)).toMatchObject({ name: "עיצוב זקן", durationMinutes: 20, priceNis: 40 });
  });

  it("toggling a day and editing its hours only affects that day", () => {
    let s = onboardingReducer(initialOnboarding, { type: "toggleDay", weekday: 5 });
    expect(s.hours[5].open).toBe(!initialOnboarding.hours[5].open);
    s = onboardingReducer(s, { type: "setHours", weekday: 1, index: 0, from: "10:00", to: "19:00" });
    expect(s.hours[1].windows).toEqual([{ from: "10:00", to: "19:00" }]);
    expect(s.hours[2]).toEqual(initialOnboarding.hours[2]);
  });
});

describe("business kinds in onboarding", () => {
  it.each(KIND_IDS)("%s: choosing the kind seeds its services and hours", (kind) => {
    const s = onboardingReducer(initialOnboarding, { type: "setType", kind });
    expect(s.business.type).toBe(kind);
    expect(s.services.map((x) => x.name)).toEqual(BUSINESS_KINDS[kind].presets.map((p) => p.name));
    expect(s.services.every(serviceValid)).toBe(true);
    expect(s.hours.filter((h) => h.open).length).toBe(BUSINESS_KINDS[kind].hours.filter((w) => w.length > 0).length);
    expect(hoursValid(s.hours)).toBe(true);
  });

  it("re-selecting the same kind does not wipe edits", () => {
    let s = onboardingReducer(initialOnboarding, { type: "setType", kind: "trainer" });
    s = onboardingReducer(s, { type: "updateService", id: s.services[0].id, patch: { priceNis: 999 } });
    expect(onboardingReducer(s, { type: "setType", kind: "trainer" })).toBe(s);
  });

  it("trainer starts with a split day (two windows)", () => {
    const s = onboardingReducer(initialOnboarding, { type: "setType", kind: "trainer" });
    expect(s.hours[0].windows).toEqual([{ from: "06:00", to: "10:00" }, { from: "17:00", to: "21:00" }]);
  });

  it("windows can be added (max 3) and removed (min 1); overlaps and inversions are invalid", () => {
    let s = onboardingReducer(initialOnboarding, { type: "addWindow", weekday: 1 });
    expect(s.hours[1].windows).toHaveLength(2);
    expect(hoursValid(s.hours)).toBe(true); // added window is placed after the previous one
    s = onboardingReducer(s, { type: "addWindow", weekday: 1 });
    s = onboardingReducer(s, { type: "addWindow", weekday: 1 });
    expect(s.hours[1].windows).toHaveLength(3);
    s = onboardingReducer(s, { type: "removeWindow", weekday: 1, index: 2 });
    s = onboardingReducer(s, { type: "removeWindow", weekday: 1, index: 1 });
    expect(onboardingReducer(s, { type: "removeWindow", weekday: 1, index: 0 }).hours[1].windows).toHaveLength(1);
    expect(windowsValid([{ from: "09:00", to: "12:00" }, { from: "11:00", to: "14:00" }])).toBe(false);
    expect(windowsValid([{ from: "09:00", to: "12:00" }, { from: "12:00", to: "14:00" }])).toBe(true);
    expect(windowsValid([{ from: "12:00", to: "09:00" }])).toBe(false);
    expect(windowProblem([{ from: "09:00", to: "12:00" }, { from: "11:00", to: "14:00" }], 1)).toBe("overlap");
    expect(windowProblem([{ from: "12:00", to: "09:00" }], 0)).toBe("order");
  });
});
