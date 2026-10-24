import { describe, expect, it } from "vitest";
import * as C from "@/lib/api/contracts";

describe("Customer management & merge contracts", () => {
  it("validates UpdateCustomerRequest correctly", () => {
    const valid = { fullName: "ישראל ישראלי", phone: "050-1234567", email: "israel@example.com" };
    expect(C.UpdateCustomerRequest.safeParse(valid).success).toBe(true);

    const validNoEmail = { fullName: "ישראל ישראלי", phone: "050-1234567" };
    expect(C.UpdateCustomerRequest.safeParse(validNoEmail).success).toBe(true);

    const validNullEmail = { fullName: "ישראל ישראלי", phone: "050-1234567", email: null };
    expect(C.UpdateCustomerRequest.safeParse(validNullEmail).success).toBe(true);

    const invalidEmail = { fullName: "ישראל ישראלי", phone: "050-1234567", email: "not-an-email" };
    expect(C.UpdateCustomerRequest.safeParse(invalidEmail).success).toBe(false);

    const shortName = { fullName: "א", phone: "050-1234567" };
    expect(C.UpdateCustomerRequest.safeParse(shortName).success).toBe(false);

    const badPhone = { fullName: "ישראל ישראלי", phone: "123" };
    expect(C.UpdateCustomerRequest.safeParse(badPhone).success).toBe(false);
  });

  it("validates MergeCustomersRequest requires target uuid", () => {
    expect(C.MergeCustomersRequest.safeParse({ targetId: "6c9c4c71-024e-403d-81b4-8b69ee5d3cfe" }).success).toBe(true);
    expect(C.MergeCustomersRequest.safeParse({ targetId: "invalid" }).success).toBe(false);
    expect(C.MergeCustomersRequest.safeParse({}).success).toBe(false);
  });

  it("validates CreateManualRequest supports customerId and optional email", () => {
    const base = {
      serviceId: "srv_1",
      date: "2026-10-25",
      time: "14:30",
      customer: { fullName: "דנה כהן", phone: "054-9876543" },
    };
    expect(C.CreateManualRequest.safeParse(base).success).toBe(true);

    const withEmail = {
      ...base,
      email: "dana@example.com",
    };
    expect(C.CreateManualRequest.safeParse(withEmail).success).toBe(true);

    const withCustomerAndEmail = {
      ...base,
      customerId: "6c9c4c71-024e-403d-81b4-8b69ee5d3cfe",
      email: "dana@example.com",
    };
    expect(C.CreateManualRequest.safeParse(withCustomerAndEmail).success).toBe(true);

    const withBadEmail = {
      ...base,
      email: "bad-email",
    };
    expect(C.CreateManualRequest.safeParse(withBadEmail).success).toBe(false);
  });
});
