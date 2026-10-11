// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const reset = () => vi.unstubAllEnvs();
afterEach(reset);

describe("e-mail provider selection fails closed", () => {
  it("outside production the default is the fake provider", async () => {
    const { emailProvider } = await import("@/modules/notifications/config");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("EMAIL_PROVIDER", "");
    delete process.env.EMAIL_PROVIDER;
    expect(emailProvider().name).toBe("fake");
  });
  it("production never uses the fake provider, even when asked", async () => {
    const { emailProvider } = await import("@/modules/notifications/config");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("EMAIL_PROVIDER", "fake");
    expect(() => emailProvider()).toThrow(/not allowed in production/);
  });
  it("production without a key or sender refuses to start sending", async () => {
    const { emailProvider } = await import("@/modules/notifications/config");
    vi.stubEnv("VERCEL_ENV", "production");
    delete process.env.EMAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    expect(() => emailProvider()).toThrow(/RESEND_API_KEY/);
    vi.stubEnv("RESEND_API_KEY", "re_x");
    expect(() => emailProvider()).toThrow(/EMAIL_FROM/);
    vi.stubEnv("EMAIL_FROM", "Tori <noreply@tori.example>");
    expect(emailProvider().name).toBe("resend");
  });
  it("an unknown provider name is refused", async () => {
    const { emailProvider } = await import("@/modules/notifications/config");
    vi.stubEnv("EMAIL_PROVIDER", "smtp");
    expect(() => emailProvider()).toThrow(/unknown/);
  });
  it("address hashes are keyed, case-insensitive and stable; production needs a pepper", async () => {
    const { addressHash } = await import("@/modules/notifications/config");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(addressHash(" A@B.co ")).toBe(addressHash("a@b.co"));
    expect(addressHash("a@b.co")).not.toBe(addressHash("a@b.com"));
    expect(addressHash("a@b.co")).toMatch(/^[0-9a-f]{64}$/);
    vi.stubEnv("VERCEL_ENV", "production");
    delete process.env.NOTIFICATIONS_PEPPER;
    expect(() => addressHash("a@b.co")).toThrow(/PEPPER/);
  });
});

describe("cron authorization", () => {
  const call = async (header?: string) => {
    const { authorizeCron } = await import("@/lib/security/cron");
    try {
      authorizeCron(new Request("http://x/api/jobs/outbox", { headers: header ? { authorization: header } : {} }));
      return "ok";
    } catch (e) {
      return (e as { code: string }).code;
    }
  };
  it("is unavailable until a long enough secret is configured (fails closed)", async () => {
    delete process.env.CRON_SECRET;
    expect(await call("Bearer anything")).toBe("UNAVAILABLE");
    vi.stubEnv("CRON_SECRET", "short");
    expect(await call("Bearer short")).toBe("UNAVAILABLE");
  });
  it("accepts only the exact bearer secret", async () => {
    vi.stubEnv("CRON_SECRET", "0123456789abcdef-secret");
    expect(await call("Bearer 0123456789abcdef-secret")).toBe("ok");
    expect(await call("Bearer 0123456789abcdef-secreT")).toBe("UNAUTHENTICATED");
    expect(await call("Bearer ")).toBe("UNAUTHENTICATED");
    expect(await call("0123456789abcdef-secret")).toBe("UNAUTHENTICATED");
    expect(await call(undefined)).toBe("UNAUTHENTICATED");
  });
});
