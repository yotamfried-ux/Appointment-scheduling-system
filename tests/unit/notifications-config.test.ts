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
    const secret = `dummy-${"x".repeat(20)}`; // built at runtime: a placeholder, not a credential
    vi.stubEnv("CRON_SECRET", secret);
    expect(await call(`Bearer ${secret}`)).toBe("ok");
    expect(await call(`Bearer ${secret.slice(0, -1)}y`)).toBe("UNAUTHENTICATED");
    expect(await call("Bearer ")).toBe("UNAUTHENTICATED");
    expect(await call(secret)).toBe("UNAUTHENTICATED");
    expect(await call(undefined)).toBe("UNAUTHENTICATED");
  });
});

describe("monitoring authorization", () => {
  const call = async (header?: string) => {
    const { authorizeMonitoring } = await import("@/lib/security/cron");
    try {
      authorizeMonitoring(new Request("http://x/api/jobs/health", { headers: header ? { authorization: header } : {} }));
      return "ok";
    } catch (e) {
      return (e as { code: string }).code;
    }
  };
  it("fails closed when neither MONITOR_SECRET nor CRON_SECRET is configured or long enough", async () => {
    delete process.env.MONITOR_SECRET;
    delete process.env.CRON_SECRET;
    expect(await call("Bearer anything")).toBe("UNAVAILABLE");
    vi.stubEnv("MONITOR_SECRET", "short");
    vi.stubEnv("CRON_SECRET", "short");
    expect(await call("Bearer short")).toBe("UNAVAILABLE");
  });
  it("authenticates successfully with least-privilege MONITOR_SECRET", async () => {
    const monitorSecret = `monitor-${"m".repeat(20)}`;
    vi.stubEnv("MONITOR_SECRET", monitorSecret);
    delete process.env.CRON_SECRET;
    expect(await call(`Bearer ${monitorSecret}`)).toBe("ok");
    expect(await call(`Bearer wrong-token`)).toBe("UNAUTHENTICATED");
    expect(await call(undefined)).toBe("UNAUTHENTICATED");
  });
  it("falls back to CRON_SECRET if MONITOR_SECRET is not configured", async () => {
    delete process.env.MONITOR_SECRET;
    const cronSecret = `cron-${"c".repeat(20)}`;
    vi.stubEnv("CRON_SECRET", cronSecret);
    expect(await call(`Bearer ${cronSecret}`)).toBe("ok");
    expect(await call(`Bearer wrong-token`)).toBe("UNAUTHENTICATED");
  });
  it("accepts either secret when both are configured", async () => {
    const monitorSecret = `monitor-${"m".repeat(20)}`;
    const cronSecret = `cron-${"c".repeat(20)}`;
    vi.stubEnv("MONITOR_SECRET", monitorSecret);
    vi.stubEnv("CRON_SECRET", cronSecret);
    expect(await call(`Bearer ${monitorSecret}`)).toBe("ok");
    expect(await call(`Bearer ${cronSecret}`)).toBe("ok");
    expect(await call(`Bearer wrong-token`)).toBe("UNAUTHENTICATED");
  });
  it("least-privilege MONITOR_SECRET cannot authorize mutating cron endpoints", async () => {
    const { authorizeCron } = await import("@/lib/security/cron");
    const monitorSecret = `monitor-${"m".repeat(20)}`;
    const cronSecret = `cron-${"c".repeat(20)}`;
    vi.stubEnv("MONITOR_SECRET", monitorSecret);
    vi.stubEnv("CRON_SECRET", cronSecret);
    expect(() =>
      authorizeCron(new Request("http://x/api/jobs/outbox", { headers: { authorization: `Bearer ${monitorSecret}` } })),
    ).toThrow();
  });
});

describe("appUrl (every e-mail link)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("configured address wins, then the Vercel deployment's own address, never localhost on Vercel", async () => {
    const { appUrl } = await import("@/modules/notifications/config");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_BRANCH_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    expect(appUrl()).toBe("http://127.0.0.1:3100");
    vi.stubEnv("VERCEL_URL", "x-abc.vercel.app");
    expect(appUrl()).toBe("https://x-abc.vercel.app");
    vi.stubEnv("VERCEL_BRANCH_URL", "x-git-branch.vercel.app");
    expect(appUrl()).toBe("https://x-git-branch.vercel.app");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tori-app.co.il/");
    expect(appUrl()).toBe("https://tori-app.co.il");
    vi.stubEnv("APP_URL", "https://app.example.co.il");
    expect(appUrl()).toBe("https://app.example.co.il");
  });
});
