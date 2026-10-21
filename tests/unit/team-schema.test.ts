import { describe, expect, it } from "vitest";
import { mapTeamError, ServiceStaffInput, StaffNameInput, StaffUpdateInput } from "@/modules/team/schema";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

describe("StaffNameInput (T13: 1–80 characters, trimmed)", () => {
  it("trims and accepts a normal name", () => expect(StaffNameInput.parse("  נועם  ")).toBe("נועם"));
  it("refuses empty, blank and longer than 80 (negative controls)", () => {
    expect(StaffNameInput.safeParse("").success).toBe(false);
    expect(StaffNameInput.safeParse("   ").success).toBe(false);
    expect(StaffNameInput.safeParse("x".repeat(81)).success).toBe(false);
    expect(StaffNameInput.safeParse("x".repeat(80)).success).toBe(true);
  });
  it("refuses non-strings", () => expect(StaffNameInput.safeParse(5).success).toBe(false));
});

describe("StaffUpdateInput", () => {
  it("needs an id and at least one change", () => {
    expect(StaffUpdateInput.safeParse({ id: U1, name: "דנה" }).success).toBe(true);
    expect(StaffUpdateInput.safeParse({ id: U1, active: false }).success).toBe(true);
    expect(StaffUpdateInput.safeParse({ id: U1 }).success).toBe(false);
    expect(StaffUpdateInput.safeParse({ id: "nope", active: true }).success).toBe(false);
  });
  it("is strict: no other column can be smuggled in", () => {
    expect(StaffUpdateInput.safeParse({ id: U1, active: true, kind: "room" }).success).toBe(false);
    expect(StaffUpdateInput.safeParse({ id: U1, active: true, business_id: U2 }).success).toBe(false);
  });
});

describe("ServiceStaffInput (T2)", () => {
  it("an empty list is valid (everybody)", () => expect(ServiceStaffInput.parse({ serviceId: U1, resourceIds: [] }).resourceIds).toEqual([]));
  it("dedupes, and refuses more than 30 or non-uuids", () => {
    expect(ServiceStaffInput.parse({ serviceId: U1, resourceIds: [U2, U2] }).resourceIds).toEqual([U2]);
    expect(ServiceStaffInput.safeParse({ serviceId: U1, resourceIds: Array.from({ length: 31 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`) }).success).toBe(false);
    expect(ServiceStaffInput.safeParse({ serviceId: U1, resourceIds: ["x"] }).success).toBe(false);
  });
});

describe("mapTeamError: database refusals become stable codes", () => {
  it.each([
    [{ message: "team_limit" }, "LIMIT"],
    [{ message: "name_taken" }, "NAME_TAKEN"],
    [{ message: "last_active_person" }, "LAST_ACTIVE"],
    [{ message: "resource_mismatch" }, "FORBIDDEN"],
    [{ code: "42501" }, "FORBIDDEN"],
    [{ code: "23514" }, "VALIDATION"],
    [{ message: "boom" }, "INTERNAL"],
    [null, "INTERNAL"],
  ])("%j → %s", (e, code) => expect(mapTeamError(e as never)).toBe(code));
});
