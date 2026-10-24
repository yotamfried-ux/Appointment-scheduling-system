import { describe, expect, it, vi } from "vitest";
import { composeFrom, providerReason, resendAdapter } from "@/modules/notifications/adapters/resend";
import { PermanentEmailError } from "@/modules/notifications/ports";

const CONF = "Tori <noreply@mail.d2ryf.com>";

/** Decode the display name of a "From" value the way a mail parser does (RFC 2047 encoded words). */
const decodedName = (from: string) => {
  const name = from.slice(0, from.lastIndexOf("<")).trim();
  const words = [...name.matchAll(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g)];
  return words.length ? words.map((w) => Buffer.from(w[1], "base64").toString("utf8")).join("") : name.replace(/^"|"$/g, "");
};

describe("composeFrom: the sender shows the business the customer booked with", () => {
  it("an ASCII name is quoted and the configured address is kept", () => {
    expect(composeFrom(CONF, "Hadar Barber")).toBe('"Hadar Barber" <noreply@mail.d2ryf.com>');
    expect(composeFrom("noreply@mail.d2ryf.com", "Hadar Barber")).toBe('"Hadar Barber" <noreply@mail.d2ryf.com>');
  });
  it("a Hebrew name is sent as RFC 2047 encoded words: the whole header value is ASCII, the address is untouched, and it decodes back to the name", () => {
    for (const name of ["המספרה", "מספרת הדר", "מרפאת השיניים של ד\"ר כהן ובניו - תל אביב והסביבה"]) {
      const out = composeFrom(CONF, name);
      expect(out).toMatch(/^[\x20-\x7e]+$/); // nothing raw and non-ASCII reaches the provider's address parser
      expect(out.endsWith(" <noreply@mail.d2ryf.com>")).toBe(true);
      for (const w of out.slice(0, out.lastIndexOf("<")).trim().split(" ")) expect(w).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
      for (const w of out.matchAll(/=\?UTF-8\?B\?[^ ]+\?=/g)) expect(w[0].length).toBeLessThanOrEqual(75); // RFC 2047 limit per word
      expect(decodedName(out)).toBe(name.replace(/"/g, " ").replace(/\s+/g, " ").trim());
    }
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
    expect(decodedName(composeFrom(CONF, "א".repeat(200))).length).toBe(60);
    expect(decodedName(composeFrom(CONF, "a".repeat(200))).length).toBe(60);
  });
});

describe("providerReason: a safe, short cause", () => {
  it("keeps the provider's error name and message", () => {
    expect(providerReason(400, { name: "invalid_from_address", message: "Invalid `from` field." })).toBe("provider 400: invalid_from_address: Invalid `from` field.");
  });
  it("never carries an address, line breaks or more than 120 characters of detail", () => {
    const r = providerReason(422, { name: "validation_error", message: `bad to yotam.fried@gmail.com\nand ${"x".repeat(300)}` });
    expect(r).not.toContain("@");
    expect(r).not.toContain("\n");
    expect(r.length).toBeLessThanOrEqual("provider 422: ".length + 120);
  });
  it("is just the status when the body is unreadable", () => {
    expect(providerReason(400, null)).toBe("provider 400");
    expect(providerReason(400, "text")).toBe("provider 400");
  });
});

describe("resend adapter: the request for a Hebrew business", () => {
  const msg = { to: "a@b.co", subject: "התור שלך אושר · המספרה", html: "<p>h</p>", text: "t", idempotencyKey: "notif-1", fromName: "המספרה", attempt: 1 };
  it("builds an ASCII-safe From and keeps the recipient, subject and body as they are", async () => {
    const f = vi.fn(async () => Response.json({ id: "x" }));
    await resendAdapter({ apiKey: "k", from: CONF, fetchImpl: f as unknown as typeof fetch }).send(msg);
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.from).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <noreply@mail\.d2ryf\.com>$/);
    expect(decodedName(body.from)).toBe("המספרה");
    expect(body.to).toEqual(["a@b.co"]);
  });
  it("a 400 that carried a custom name is retried once with the configured sender and a different idempotency key", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(Response.json({ name: "invalid_from_address", message: "Invalid from" }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ id: "ok" }));
    await expect(resendAdapter({ apiKey: "k", from: CONF, fetchImpl: f as unknown as typeof fetch }).send(msg)).resolves.toEqual({ id: "ok" });
    const [, second] = f.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(second.body as string).from).toBe(CONF);
    expect((second.headers as Record<string, string>)["Idempotency-Key"]).toBe("notif-1-plain");
  });
  it("a 400 that persists is permanent and stores the provider's reason, not the recipient", async () => {
    const f = vi.fn(async () => Response.json({ name: "validation_error", message: "Invalid `to` field a@b.co" }, { status: 400 }));
    const err = await resendAdapter({ apiKey: "k", from: CONF, fetchImpl: f as unknown as typeof fetch }).send(msg).catch((e) => e);
    expect(err).toBeInstanceOf(PermanentEmailError);
    expect(err.message).toBe("provider 400: validation_error: Invalid `to` field [address]");
    expect(f).toHaveBeenCalledTimes(2);
  });
});
