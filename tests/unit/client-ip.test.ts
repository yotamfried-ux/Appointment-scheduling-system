import { describe, expect, it } from "vitest";
import { ipFromHeaders } from "@/lib/client-ip";

const h = (o: Record<string, string>) => new Headers(o);

describe("ipFromHeaders", () => {
  it("prefers the platform header over one the client can set", () => {
    expect(ipFromHeaders(h({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "1.2.3.4" }))).toBe("203.0.113.7");
  });
  it("falls back to x-forwarded-for (first entry), then x-real-ip, then unknown", () => {
    expect(ipFromHeaders(h({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
    expect(ipFromHeaders(h({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(ipFromHeaders(h({}))).toBe("unknown");
  });
});
