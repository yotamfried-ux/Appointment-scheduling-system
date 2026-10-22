import { describe, expect, it } from "vitest";
import { mapRpcError } from "@/modules/tenancy/errors";
import { CreateBusinessInput, slugCandidates } from "@/modules/tenancy/schema";
import { initialOnboarding, kindHours } from "@/lib/lab/onboarding";

const base = {
  name: "מספרת הדר",
  kind: "barber",
  phone: "050-1234567",
  services: [{ name: "תספורת", durationMinutes: 30, priceNis: 80 }],
  hours: kindHours("barber"),
};

describe("CreateBusinessInput (SEC-02/SEC-08/ACC-03)", () => {
  it("accepts a valid payload and normalises the phone to E.164", () => {
    const r = CreateBusinessInput.parse(base);
    expect(r.phone).toBe("+972501234567");
  });
  it("rejects client-supplied tenant/slug/extra fields (strict)", () => {
    expect(CreateBusinessInput.safeParse({ ...base, businessId: "x" }).success).toBe(false);
    expect(CreateBusinessInput.safeParse({ ...base, slug: "mine" }).success).toBe(false);
    expect(CreateBusinessInput.safeParse({ ...base, created_by: "x" }).success).toBe(false);
  });
  it.each([
    ["short name", { name: "א" }],
    ["unknown kind", { kind: "plumber" }],
    ["bad phone", { phone: "050-12" }],
    ["no services", { services: [] }],
    ["zero price", { services: [{ name: "תספורת", durationMinutes: 30, priceNis: 0 }] }],
    ["huge duration", { services: [{ name: "תספורת", durationMinutes: 9999, priceNis: 10 }] }],
    ["all days closed", { hours: kindHours("barber").map((h) => ({ ...h, open: false })) }],
    ["overlapping windows", { hours: kindHours("barber").map((h, i) => (i === 0 ? { ...h, windows: [{ from: "09:00", to: "12:00" }, { from: "11:00", to: "14:00" }] } : h)) }],
    ["inverted window", { hours: kindHours("barber").map((h, i) => (i === 0 ? { ...h, windows: [{ from: "18:00", to: "09:00" }] } : h)) }],
  ])("rejects %s", (_n, patch) => {
    expect(CreateBusinessInput.safeParse({ ...base, ...patch }).success).toBe(false);
  });
  it("treats script-like names as plain text (stored, escaped on output)", () => {
    expect(CreateBusinessInput.safeParse({ ...base, name: "<script>alert(1)</script>" }).success).toBe(true);
  });
  it("accepts the default onboarding state shape", () => {
    expect(CreateBusinessInput.safeParse({ ...base, hours: initialOnboarding.hours }).success).toBe(true);
  });
});

describe("slugCandidates (ACC-06)", () => {
  it("starts with the safe base slug and falls back to numbered variants within 40 chars", () => {
    const c = slugCandidates("מספרת הדר");
    expect(c).toHaveLength(8);
    expect(new Set(c).size).toBe(8);
    expect(c.slice(1, 5).map((x) => x.split("-").at(-1))).toEqual(["2", "3", "4", "5"]);
    expect(c.slice(5).every((x) => /-[0-9a-z]{4}$/.test(x))).toBe(true); // random fallbacks after the numbered ones
    for (const s of c) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const long = slugCandidates("a".repeat(80));
    for (const s of long) expect(s.length).toBeLessThanOrEqual(40);
  });
  it("random fallbacks differ between calls (so concurrent signups with one name do not collide)", () => {
    expect(slugCandidates("מספרת הדר").slice(5)).not.toEqual(slugCandidates("מספרת הדר").slice(5));
  });
  it("never returns a reserved or too-short slug", () => {
    for (const s of slugCandidates("admin")) expect(s).not.toBe("admin");
    for (const s of slugCandidates("ד")) expect(s.length).toBeGreaterThanOrEqual(3);
  });
});

describe("mapRpcError", () => {
  it.each([
    [{ code: "P0001", message: "slug_taken" }, "SLUG_TAKEN"],
    [{ code: "23505", message: "duplicate key" }, "SLUG_TAKEN"],
    [{ code: "23514", message: 'violates check constraint "businesses_slug_not_reserved"' }, "SLUG_INVALID"],
    [{ code: "23514", message: 'violates check constraint "businesses_name_check"' }, "VALIDATION"],
    [{ code: "P0001", message: "business_limit" }, "BUSINESS_LIMIT"],
    [{ code: "P0001", message: "rate_limited" }, "RATE_LIMITED"],
    [{ code: "P0001", message: "email_not_verified" }, "EMAIL_NOT_VERIFIED"],
    [{ code: "P0001", message: "needs_review" }, "NEEDS_REVIEW"],
    [{ code: "P0001", message: "suspended" }, "SUSPENDED"],
    [{ code: "42501", message: "permission denied" }, "FORBIDDEN"],
    [{ code: "28000", message: "not_authenticated" }, "NOT_AUTHENTICATED"],
    [{ code: "XX000", message: "relation public.secret_table does not exist" }, "INTERNAL"],
    [null, "INTERNAL"],
  ])("%j → %s", (e, expected) => expect(mapRpcError(e)).toBe(expected));
});
