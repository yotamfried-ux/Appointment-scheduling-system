import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone } from "@/lib/phone";

describe("phone normalization & uniform formatting", () => {
  const inputs = [
    "0501234567",
    "050-123-4567",
    "050-1234567",
    "050 123 4567",
    "050.123.4567",
    "+972501234567",
    "+972 50-123-4567",
    "972501234567",
  ];

  it("normalizes all input variations of an Israeli mobile number to uniform E.164 (+972501234567)", () => {
    for (const input of inputs) {
      expect(normalizePhone(input)).toBe("+972501234567");
    }
  });

  it("formats all input variations into a single, clean national display format (050-123-4567)", () => {
    for (const input of inputs) {
      expect(formatPhone(input)).toBe("050-123-4567");
    }
  });

  it("formats Israeli landline numbers properly (03-555-1234)", () => {
    expect(normalizePhone("035551234")).toBe("+97235551234");
    expect(formatPhone("035551234")).toBe("03-555-1234");
    expect(formatPhone("+97235551234")).toBe("03-555-1234");
  });

  it("handles empty or invalid inputs gracefully", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("1234")).toBeNull();
    expect(formatPhone("")).toBe("");
    expect(formatPhone("invalid-phone")).toBe("invalid-phone");
  });
});
