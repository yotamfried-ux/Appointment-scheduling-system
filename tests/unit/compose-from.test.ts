import { describe, expect, it } from "vitest";
import { composeFrom } from "@/modules/notifications/adapters/resend";

const CONF = "Tori <noreply@mail.d2ryf.com>";

describe("composeFrom: the sender shows the business the customer booked with", () => {
  it("uses the business name and keeps the configured address", () => {
    expect(composeFrom(CONF, "מספרת הדר")).toBe('"מספרת הדר" <noreply@mail.d2ryf.com>');
    expect(composeFrom("noreply@mail.d2ryf.com", "Hadar Barber")).toBe('"Hadar Barber" <noreply@mail.d2ryf.com>');
  });
  it("falls back to the configured sender when there is no usable name", () => {
    expect(composeFrom(CONF, undefined)).toBe(CONF);
    expect(composeFrom(CONF, "  ")).toBe(CONF);
    expect(composeFrom(CONF, "<>@")).toBe(CONF);
  });
  it("a business name can never look like another address or break the header", () => {
    const out = composeFrom(CONF, 'PayPal <support@paypal.com>"\r\nBcc: x@y.com');
    expect(out).not.toMatch(/[\r\n]/);
    expect(out.match(/@/g)).toHaveLength(1); // only the configured address
    expect(out.endsWith("<noreply@mail.d2ryf.com>")).toBe(true);
  });
  it("is limited to 60 characters", () => {
    const name = composeFrom(CONF, "א".repeat(200)).match(/^"(.*)" </)![1];
    expect(name.length).toBe(60);
  });
});
