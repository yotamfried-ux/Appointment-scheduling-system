import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Mock next/navigation
const mockRedirect = vi.fn((url: string) => {
  const err = new Error(`NEXT_REDIRECT: ${url}`);
  (err as unknown as { digest: string }).digest = `NEXT_REDIRECT;replace;${url};307;;`;
  throw err;
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
}));

// Mock next-intl/server
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => {
    const t = (k: string) => k;
    t.raw = () => [];
    return t;
  }),
}));

// Mock dependencies
const mockGetClaims = vi.fn();
const mockSupabase = {
  auth: {
    getClaims: mockGetClaims,
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => mockSupabase),
}));

const mockCheckSession = vi.fn();
vi.mock("@/lib/auth/live-session", () => ({
  checkSession: (...args: unknown[]) => mockCheckSession(...args),
}));

const mockLegalGateActive = vi.fn();
const mockMissingAcceptances = vi.fn();
vi.mock("@/lib/legal/gate", () => ({
  legalGateActive: (...args: unknown[]) => mockLegalGateActive(...args),
  missingAcceptances: (...args: unknown[]) => mockMissingAcceptances(...args),
}));

const mockListMyBusinesses = vi.fn();
vi.mock("@/modules/tenancy/service", () => ({
  listMyBusinesses: (...args: unknown[]) => mockListMyBusinesses(...args),
}));

const mockIsPlatformAdmin = vi.fn();
vi.mock("@/modules/admin/service", () => ({
  isPlatformAdmin: (...args: unknown[]) => mockIsPlatformAdmin(...args),
}));

import Home from "@/app/page";

describe("Root Navigation Server-Side Redirects (app/page.tsx)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLegalGateActive.mockResolvedValue(false);
    mockMissingAcceptances.mockResolvedValue([]);
  });

  it("renders public home page without redirecting when user is unauthenticated", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: null } });

    const result = await Home();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("renders public home page without redirecting when session is expired or revoked (gate.live = false)", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "user-123" } } });
    mockCheckSession.mockResolvedValue({ live: false, secondFactor: false });

    const result = await Home();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("redirects to /auth/mfa when MFA is required and not verified (gate.secondFactor = false)", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "user-123" } } });
    mockCheckSession.mockResolvedValue({ live: true, secondFactor: false });

    await expect(Home()).rejects.toThrow("NEXT_REDIRECT: /auth/mfa");
    expect(mockRedirect).toHaveBeenCalledWith("/auth/mfa");
  });

  it("redirects to /legal/accept when legal terms gate is active and acceptances are missing", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "user-123" } } });
    mockCheckSession.mockResolvedValue({ live: true, secondFactor: true });
    mockLegalGateActive.mockResolvedValue(true);
    mockMissingAcceptances.mockResolvedValue(["terms"]);

    await expect(Home()).rejects.toThrow("NEXT_REDIRECT: /legal/accept");
    expect(mockRedirect).toHaveBeenCalledWith("/legal/accept");
  });

  it("redirects business owner to /dashboard when they have at least one business", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "user-123", email: "owner@example.com" } } });
    mockCheckSession.mockResolvedValue({ live: true, secondFactor: true });
    mockListMyBusinesses.mockResolvedValue([
      { id: "biz-1", slug: "barber-shop", name: "Barber Shop", kind: "barber", published_at: "2026-01-01" },
    ]);
    mockIsPlatformAdmin.mockResolvedValue(false);

    await expect(Home()).rejects.toThrow("NEXT_REDIRECT: /dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects user with no businesses to /onboarding", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "user-456", email: "newuser@example.com" } } });
    mockCheckSession.mockResolvedValue({ live: true, secondFactor: true });
    mockListMyBusinesses.mockResolvedValue([]);
    mockIsPlatformAdmin.mockResolvedValue(false);

    await expect(Home()).rejects.toThrow("NEXT_REDIRECT: /onboarding");
    expect(mockRedirect).toHaveBeenCalledWith("/onboarding");
  });

  it("redirects platform administrator without a business directly to /admin", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "admin-789", email: "yotam.fried@gmail.com" } } });
    mockCheckSession.mockResolvedValue({ live: true, secondFactor: true });
    mockListMyBusinesses.mockResolvedValue([]);
    mockIsPlatformAdmin.mockResolvedValue(true);

    await expect(Home()).rejects.toThrow("NEXT_REDIRECT: /admin");
    expect(mockRedirect).toHaveBeenCalledWith("/admin");
  });

  it("redirects platform administrator WITH a business to /dashboard (accessible alongside admin)", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "admin-789", email: "yotam.fried@gmail.com" } } });
    mockCheckSession.mockResolvedValue({ live: true, secondFactor: true });
    mockListMyBusinesses.mockResolvedValue([
      { id: "biz-admin", slug: "admin-shop", name: "Admin Shop", kind: "barber", published_at: "2026-01-01" },
    ]);
    mockIsPlatformAdmin.mockResolvedValue(true);

    await expect(Home()).rejects.toThrow("NEXT_REDIRECT: /dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });
});
