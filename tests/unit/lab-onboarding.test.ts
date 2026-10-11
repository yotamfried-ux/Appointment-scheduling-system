import { describe, expect, it } from "vitest";
import {
  canContinueOnboarding,
  initialOnboarding,
  onboardingReducer,
  suggestSlug,
  DEFAULT_HOURS,
  type OnboardingState,
} from "@/lib/lab/onboarding";

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
    expect(canContinueOnboarding({ ...s, hours: s.hours.map((h, i) => (i === 0 ? { ...h, from: "18:00", to: "09:00" } : h)) })).toBe(false);
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
    let s = onboardingReducer(initialOnboarding, { type: "addService" });
    expect(s.services).toHaveLength(2);
    s = onboardingReducer(s, { type: "removeService", id: s.services[0].id });
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
    s = onboardingReducer(s, { type: "setHours", weekday: 1, from: "10:00", to: "19:00" });
    expect(s.hours[1]).toMatchObject({ from: "10:00", to: "19:00" });
    expect(s.hours[2]).toEqual(initialOnboarding.hours[2]);
  });
});
