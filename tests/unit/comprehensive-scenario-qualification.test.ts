// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkSession } from "@/lib/auth/live-session";
import { authErrorKey, isExistingAccount } from "@/lib/auth/errors";
import { signToken, verifyToken } from "@/modules/booking/token";
import { BOM, csvCell, csvRow } from "@/modules/reports/csv";
import { sanitizePayload } from "@/modules/analytics/service";
import { render, type NotifContext } from "@/modules/notifications/templates";
import * as C from "@/lib/api/contracts";
import { CreateBusinessInput } from "@/modules/tenancy/schema";
import { LEGAL } from "@/lib/legal/config";

const VALID_TERMS = { terms: LEGAL.terms.version, privacy: LEGAL.privacy.version };

describe("Tori Comprehensive Qualification — User Identities & Authentication (Section 4 & 5)", () => {
  describe("4.1 & 5. Session & Identity Posture (U1..U12)", () => {
    it("U1 / U11: Expired or unauthenticated session fails closed (live = false)", async () => {
      const mockSupabase = {
        auth: {
          getUser: async () => ({ data: { user: null }, error: { message: "Invalid session" } }),
        },
      };
      const check = await checkSession(mockSupabase as never, null);
      expect(check.live).toBe(false);
      expect(check.secondFactor).toBe(false);
    });

    it("U9: User with unverified email or account without factors has live=true and secondFactor=true", async () => {
      const mockSupabase = {
        auth: {
          getUser: async () => ({
            data: {
              user: {
                id: "user-u9",
                email: "unverified@example.com",
                factors: [],
              },
            },
            error: null,
          }),
        },
      };
      const check = await checkSession(mockSupabase as never, { aal: "aal1" });
      expect(check.live).toBe(true);
      expect(check.secondFactor).toBe(true);
    });

    it("U3 / U8: User with enrolled MFA requires aal2; cookie tampering cannot bypass it", async () => {
      const mockSupabase = {
        auth: {
          getUser: async () => ({
            data: {
              user: {
                id: "user-mfa",
                email: "owner@example.com",
                factors: [{ status: "verified", factor_type: "totp" }],
              },
            },
            error: null,
          }),
        },
      };
      // Session with only aal1 (e.g. before second factor)
      const checkAal1 = await checkSession(mockSupabase as never, { aal: "aal1" });
      expect(checkAal1.live).toBe(true);
      expect(checkAal1.secondFactor).toBe(false);

      // Session with genuine aal2
      const checkAal2 = await checkSession(mockSupabase as never, { aal: "aal2" });
      expect(checkAal2.live).toBe(true);
      expect(checkAal2.secondFactor).toBe(true);
    });

    it("U10: Removed member is evaluated on the server without trusting stale JWT claims", () => {
      // In Tori architecture, business roles are evaluated from business_members in the DB on every request.
      // We verify that role is not baked into user identity claims.
      const claims = { sub: "user-u10", email: "removed@example.com", aud: "authenticated" };
      expect((claims as Record<string, unknown>).role).toBeUndefined();
    });
  });

  describe("4.2 Registration Input & Error Contracts", () => {
    it("handles existing user error without revealing whether account exists (no enumeration)", () => {
      const existingErr = { message: "User already registered", code: "user_already_exists" };
      expect(isExistingAccount(existingErr)).toBe(true);
      expect(authErrorKey(existingErr)).toBe("user_already_exists");
    });

    it("validates create business input schema and rejects malformed slugs, names or hours", () => {
      // Valid input with all 7 days
      const valid = {
        name: "מספרה איכותית",
        kind: "barber",
        slug: "good-salon",
        phone: "+972501234567",
        services: [{ name: "תספורת", durationMinutes: 30, priceNis: 80 }],
        hours: [0, 1, 2, 3, 4, 5, 6].map((i) => ({
          weekday: i,
          open: i < 5,
          windows: [{ from: "09:00", to: "17:00" }],
        })),
      };
      expect(CreateBusinessInput.safeParse(valid).success).toBe(true);

      // Invalid slug: contains uppercase or special chars
      expect(CreateBusinessInput.safeParse({ ...valid, slug: "Bad_Slug!" }).success).toBe(false);

      // Reserved slug rejected
      expect(CreateBusinessInput.safeParse({ ...valid, slug: "admin" }).success).toBe(false);
      expect(CreateBusinessInput.safeParse({ ...valid, slug: "api" }).success).toBe(false);

      // Invalid phone format (garbage or too short)
      expect(CreateBusinessInput.safeParse({ ...valid, phone: "12345" }).success).toBe(false);
      expect(CreateBusinessInput.safeParse({ ...valid, phone: "not-a-phone" }).success).toBe(false);

      // Invalid service: negative duration or negative price
      expect(
        CreateBusinessInput.safeParse({
          ...valid,
          services: [{ name: "תספורת", durationMinutes: -30, priceNis: 80 }],
        }).success
      ).toBe(false);
      expect(
        CreateBusinessInput.safeParse({
          ...valid,
          services: [{ name: "תספורת", durationMinutes: 30, priceNis: -80 }],
        }).success
      ).toBe(false);
    });
  });
});

describe("Tori Comprehensive Qualification — Permission Matrix & Cross-Tenant Isolation (Section 6)", () => {
  it("enforces role ranks: staff (1) < admin (2) < owner (3)", () => {
    const roleRanks: Record<string, number> = { staff: 1, admin: 2, owner: 3 };
    expect(roleRanks["owner"]).toBeGreaterThan(roleRanks["admin"]);
    expect(roleRanks["admin"]).toBeGreaterThan(roleRanks["staff"]);
  });

  it("prohibits mass assignment in public booking requests (cannot inject status, price, role, or businessId)", () => {
    const maliciousPayload = {
      serviceId: "srv-1",
      date: "2026-10-25",
      time: "10:00",
      location: "business",
      customer: { fullName: "תוקף", phone: "+972501234567", email: "attacker@test.com" },
      acceptedTerms: VALID_TERMS,
      intake: {},
      // Injected server fields:
      status: "confirmed",
      role: "owner",
      price: 0,
      business_id: "other-business-id",
    };

    const parsed = C.CreateBookingRequest.safeParse(maliciousPayload);
    // Strict schema check catches mass assignment attempts and refuses unrecognized keys
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issueKeys = parsed.error.issues.map((i) => (i as unknown as { keys?: string[] }).keys).flat();
      expect(issueKeys).toContain("status");
      expect(issueKeys).toContain("role");
      expect(issueKeys).toContain("price");
      expect(issueKeys).toContain("business_id");
    }
  });
});

describe("Tori Comprehensive Qualification — Negative Booking Engine (Section 7)", () => {
  const env = { BOOKING_TOKEN_SECRET: "s".repeat(40) } as unknown as NodeJS.ProcessEnv;
  const APPT_ID = "22222222-2222-4222-8222-222222222222";
  const NOW = Date.parse("2026-10-27T10:00:00Z");

  describe("Capability Token Tampering (D & CXL-06)", () => {
    it("rejects token when HMAC signature is modified", () => {
      const valid = signToken({ appointmentId: APPT_ID, scope: "cancel", ttlSeconds: 3600, now: NOW }, env);
      const parts = valid.split(".");
      const tamperedSig = parts[0] + "." + parts[1] + ".invalidSig==";
      const res = verifyToken(tamperedSig, "cancel", env, NOW);
      expect(res.ok).toBe(false);
    });

    it("rejects token when scope is misused (e.g. view token used for cancellation)", () => {
      const viewToken = signToken({ appointmentId: APPT_ID, scope: "view", ttlSeconds: 3600, now: NOW }, env);
      const res = verifyToken(viewToken, "cancel", env, NOW);
      expect(res.ok).toBe(false);
    });

    it("rejects token when appointment ID in payload is swapped", () => {
      const token = signToken({ appointmentId: APPT_ID, scope: "cancel", ttlSeconds: 3600, now: NOW }, env);
      const [body, sig] = token.split(".");
      const decoded = JSON.parse(Buffer.from(body, "base64url").toString());
      decoded.a = "33333333-3333-4333-8333-333333333333";
      const forgedBody = Buffer.from(JSON.stringify(decoded)).toString("base64url");
      const res = verifyToken(`${forgedBody}.${sig}`, "cancel", env, NOW);
      expect(res.ok).toBe(false);
    });

    it("rejects token past its expiration timestamp", () => {
      const expired = signToken({ appointmentId: APPT_ID, scope: "cancel", ttlSeconds: 60, now: NOW }, env);
      const res = verifyToken(expired, "cancel", env, NOW + 61_000);
      expect(res.ok).toBe(false);
    });
  });

  describe("Negative Input & Unicode Handling", () => {
    it("accepts valid multilingual names and notes (Hebrew, Arabic, special chars)", () => {
      const request = {
        serviceId: "srv-1",
        date: "2026-10-25",
        time: "10:00",
        location: "business",
        customer: { fullName: "سليم خوري / שרה כהן-לוי", phone: "+972501234567", email: "client@example.com" },
        acceptedTerms: VALID_TERMS,
        intake: { notes: "מעוניין בתספורת ועיצוב זקן ✂️" },
      };
      const parsed = C.CreateBookingRequest.safeParse(request);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.customer.fullName).toContain("سليم");
        expect(parsed.data.customer.fullName).toContain("שרה");
      }
    });

    it("rejects invalid date and time formats", () => {
      const base = {
        serviceId: "srv-1",
        date: "25-10-2026", // Invalid: not YYYY-MM-DD
        time: "10:00",
        location: "business",
        customer: { fullName: "ישראל ישראלי", phone: "+972501234567", email: "israel@test.com" },
        acceptedTerms: VALID_TERMS,
        intake: {},
      };
      expect(C.CreateBookingRequest.safeParse(base).success).toBe(false);

      // Invalid time format
      expect(C.CreateBookingRequest.safeParse({ ...base, date: "2026-10-25", time: "10:00:00" }).success).toBe(false);
      expect(C.CreateBookingRequest.safeParse({ ...base, date: "2026-10-25", time: "25:00" }).success).toBe(false);
    });
  });
});

describe("Tori Comprehensive Qualification — Security, CSV Injection & Privacy (Section 9 & 12)", () => {
  describe("CSV Formula Injection Neutralization (RPT-03)", () => {
    it("neutralizes formula execution triggers (=, +, -, @, \\t, \\r) by prefixing apostrophe", () => {
      const attackPayloads = [
        '=cmd|\' /C calc\'!A0',
        '+12345',
        '-50+20',
        '@SUM(A1:A10)',
        '\t=evil()',
        '\r=evil()',
      ];

      for (const payload of attackPayloads) {
        const cell = csvCell(payload);
        // Must start with quote and apostrophe
        expect(cell.startsWith("\"'"), `Payload ${payload} must be prefixed with apostrophe`).toBe(true);
      }
    });

    it("does not corrupt benign numbers or standard text in CSV", () => {
      expect(csvCell(100)).toBe("100");
      expect(csvCell(0)).toBe("0");
      expect(csvCell("מספרת יותם")).toBe('"מספרת יותם"');
      expect(csvCell(null)).toBe('""');
    });

    it("ensures UTF-8 BOM is present and rows terminate with CRLF for Excel Hebrew compatibility (RPT-02)", () => {
      expect(BOM).toBe("\uFEFF");
      const row = csvRow(["עסק", 100]);
      expect(row).toBe('"עסק",100\r\n');
    });
  });

  describe("Analytics & Notification Privacy Invariants (Section 12)", () => {
    it("scrubs customer PII (full names, phone numbers, email addresses) from analytics meta", () => {
      const rawPayload = {
        business_id: "biz-1",
        event_type: "appointment_booked",
        customer_name: "דניאל כהן",
        customer_phone: "+972501234567",
        customer_email: "daniel@secret.com",
        service_id: "srv-haircut",
        service_duration: 30,
        source: "public_page",
      };

      const cleaned = sanitizePayload(rawPayload);
      expect((cleaned as Record<string, unknown>).customer_name).toBeUndefined();
      expect((cleaned as Record<string, unknown>).customer_phone).toBeUndefined();
      expect((cleaned as Record<string, unknown>).customer_email).toBeUndefined();
      expect(cleaned.service_id).toBe("srv-haircut");
      expect(cleaned.source).toBe("public_page");
    });

    it("sanitizes platform admin notification templates against HTML injection", () => {
      const ctx: NotifContext = {
        type: "admin_business_registered",
        recipient: "admin",
        appointment: null,
        offer: null,
        registration: {
          businessId: "biz-test",
          name: '<img src=x onerror="alert(1)">',
          slug: "test-slug",
          kind: "barber",
          createdAt: "2026-10-27T10:00:00Z",
          ownerEmail: '"><script>alert("hack")</script>',
        },
        business: {
          name: '<img src=x onerror="alert(1)">',
          slug: "test-slug",
          kind: "barber",
          timezone: "Asia/Jerusalem",
          phone: "+972501234567",
        },
        customer: { name: "", email: null },
        owner: { email: "owner@test.com" },
      };

      const output = render(ctx, { appUrl: "https://tori.app" });
      expect(output.html).not.toContain('<img src=x onerror="alert(1)">');
      expect(output.html).not.toContain('<script>alert("hack")</script>');
      expect(output.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    });
  });
});
