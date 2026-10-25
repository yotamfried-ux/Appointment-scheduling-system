import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { render, type NotifContext } from "@/modules/notifications/templates";
import { staleReason } from "@/modules/notifications/plan";
import { platformAdminEmail } from "@/modules/notifications/config";
import { recordAnalyticsEvent } from "@/modules/analytics/service";
import { isPlatformAdmin, listBusinesses, getDashboardMetrics, getSystemErrors } from "@/modules/admin/service";

describe("Platform Admin & Registration Notifications", () => {
  it("renders admin_business_registered notification template with business details and admin link", () => {
    const ctx: NotifContext = {
      type: "admin_business_registered",
      recipient: "admin",
      appointment: null,
      offer: null,
      registration: {
        businessId: "11111111-2222-3333-4444-555555555555",
        name: "מספרת בוטיק",
        slug: "boutique-barber",
        kind: "barber",
        createdAt: "2026-10-25T12:00:00Z",
        ownerEmail: "owner@boutique.co.il",
      },
      business: {
        name: "מספרת בוטיק",
        slug: "boutique-barber",
        kind: "barber",
        timezone: "Asia/Jerusalem",
        phone: "+972501234567",
      },
      customer: { name: "", email: null },
      owner: { email: "owner@boutique.co.il" },
    };

    const rendered = render(ctx, { appUrl: "https://tori.app" });

    // Invariant: System name & title
    expect(rendered.subject).toContain("עסק חדש נרשם למערכת · מספרת בוטיק");
    expect(rendered.html).toContain("ניהול יומן ותורים - התראת מנהל מערכת");
    expect(rendered.html).toContain("מספרת בוטיק");
    expect(rendered.html).toContain("11111111-2222-3333-4444-555555555555");
    expect(rendered.html).toContain("boutique-barber");
    expect(rendered.html).toContain("owner@boutique.co.il");
    expect(rendered.html).toContain("https://tori.app/admin");
    expect(rendered.text).toContain("לוח ניהול: https://tori.app/admin");
  });

  it("escapes malicious user-supplied business names to prevent HTML injection", () => {
    const ctx: NotifContext = {
      type: "admin_business_registered",
      recipient: "admin",
      appointment: null,
      offer: null,
      registration: {
        businessId: "test-id",
        name: "<script>alert('xss')</script>",
        slug: "xss-test",
        kind: "barber",
        createdAt: "2026-10-25T12:00:00Z",
        ownerEmail: "attacker@test.com",
      },
      business: {
        name: "<script>alert('xss')</script>",
        slug: "xss-test",
        kind: "barber",
        timezone: "Asia/Jerusalem",
        phone: null,
      },
      customer: { name: "", email: null },
      owner: { email: null },
    };

    const rendered = render(ctx, { appUrl: "https://tori.app" });
    expect(rendered.html).not.toContain("<script>alert('xss')</script>");
    expect(rendered.html).toContain("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
  });

  it("never marks admin_business_registered notifications as stale", () => {
    const stale = staleReason("admin_business_registered", "registered", "2026-10-25T12:00:00Z", new Date());
    expect(stale).toBeNull();
  });

  it("returns configured or default platform admin email", () => {
    const email = platformAdminEmail();
    expect(email).toBe("yotam.fried@gmail.com");
  });
});

describe("Analytics Service Privacy & Invariants", () => {
  it("scrubs customer PII before saving analytics events", async () => {
    let capturedPayload: Record<string, unknown> | null = null;
    const fakeSupabase = {
      from: (table: string) => {
        expect(table).toBe("analytics_events");
        return {
          insert: (data: { business_id: string; event_type: string; payload: Record<string, unknown> }) => {
            capturedPayload = data.payload;
            return Promise.resolve({ error: null });
          },
        };
      },
    } as any;

    const ok = await recordAnalyticsEvent(fakeSupabase, {
      businessId: "00000000-0000-0000-0000-000000000001",
      eventType: "booking_created",
      eventTarget: "appointment-123",
      payload: {
        service_id: "srv-1",
        price: 150,
        customer_email: "secret@customer.com",
        customer_phone: "050-0000000",
        name: "Customer Name",
        phone: "050-0000000",
      },
    });

    expect(ok).toBe(true);
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload).toEqual({
      service_id: "srv-1",
      price: 150,
    });
    expect((capturedPayload as any).customer_email).toBeUndefined();
    expect((capturedPayload as any).customer_phone).toBeUndefined();
    expect((capturedPayload as any).name).toBeUndefined();
  });
});

describe("Platform Admin Service & RPC Mapping", () => {
  it("verifies platform admin via is_platform_admin RPC", async () => {
    const adminClient = {
      rpc: (fn: string) => {
        expect(fn).toBe("is_platform_admin");
        return Promise.resolve({ data: true, error: null });
      },
    } as any;

    const nonAdminClient = {
      rpc: (fn: string) => {
        expect(fn).toBe("is_platform_admin");
        return Promise.resolve({ data: false, error: null });
      },
    } as any;

    expect(await isPlatformAdmin(adminClient)).toBe(true);
    expect(await isPlatformAdmin(nonAdminClient)).toBe(false);
  });

  it("maps dashboard metrics and funnel correctly", async () => {
    const mockMetrics = {
      totalBusinesses: 5,
      newBusinesses: 2,
      activeBusinesses: 4,
      activePercentage: 80,
      bookingsInPeriod: 120,
      bookingsGrowth: 15.5,
      completedPercentage: 92.4,
      funnel: {
        registered: 5,
        serviceCreated: 5,
        servicePercentage: 100,
        pagePublished: 4,
        publishedPercentage: 80,
        firstBooking: 3,
        firstBookingPercentage: 60,
      },
      registrationsOverTime: [
        { period: "12/10", count: 2 },
        { period: "19/10", count: 3 },
      ],
      financial: {
        mrrNis: 1490,
        arrNis: 17880,
        activeSubscribers: 10,
        trialingSubscribers: 5,
        pastDueSubscribers: 1,
        totalGmvNis: 45200,
        periodGmvNis: 12400,
        averageBookingValueNis: 95.5,
        plans: [
          { planId: "pro", planName: "מקצועי", priceNis: 149, subscribers: 8, revenueNis: 1192 },
          { planId: "starter", planName: "בסיס", priceNis: 79, subscribers: 2, revenueNis: 158 },
        ],
      },
    };

    const client = {
      rpc: (fn: string) => {
        expect(fn).toBe("admin_dashboard_metrics");
        return Promise.resolve({ data: mockMetrics, error: null });
      },
    } as any;

    const result = await getDashboardMetrics(client);
    expect(result.totalBusinesses).toBe(5);
    expect(result.funnel.firstBookingPercentage).toBe(60);
    expect(result.registrationsOverTime).toHaveLength(2);
    expect(result.financial?.mrrNis).toBe(1490);
    expect(result.financial?.arrNis).toBe(17880);
    expect(result.financial?.totalGmvNis).toBe(45200);
    expect(result.financial?.plans).toHaveLength(2);
    expect(result.financial?.plans[0].planId).toBe("pro");
  });

  it("strictly refuses non-admin users in isPlatformAdmin", async () => {
    const unprivilegedClient = {
      rpc: (fn: string) => {
        expect(fn).toBe("is_platform_admin");
        return Promise.resolve({ data: false, error: null });
      },
    } as any;

    const isAdmin = await isPlatformAdmin(unprivilegedClient);
    expect(isAdmin).toBe(false);

    const erroringClient = {
      rpc: () => Promise.resolve({ data: null, error: { message: "forbidden", code: "42501" } }),
    } as any;

    const isAdminError = await isPlatformAdmin(erroringClient);
    expect(isAdminError).toBe(false);
  });

  it("maps business list and aggregates without exposing customer data", async () => {
    const mockRows = [
      {
        id: "biz-1",
        name: "עסק לדוגמה",
        slug: "example-biz",
        kind: "barber",
        phone: "+972500000000",
        published_at: "2026-10-25T10:00:00Z",
        created_at: "2026-10-25T09:00:00Z",
        owner_email: "yotam.fried@gmail.com",
        total_appointments: "15",
        cancelled_appointments: "2",
        cancellation_rate: "13.3",
        services_count: "4",
        staff_count: "2",
        waitlist_enabled: true,
      },
    ];

    const client = {
      rpc: (fn: string) => {
        expect(fn).toBe("admin_list_businesses");
        return Promise.resolve({ data: mockRows, error: null });
      },
    } as any;

    const list = await listBusinesses(client);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: "biz-1",
      name: "עסק לדוגמה",
      slug: "example-biz",
      total_appointments: 15,
      cancelled_appointments: 2,
      cancellation_rate: 13.3,
      services_count: 4,
      staff_count: 2,
      waitlist_enabled: true,
    });
  });

  it("maps system operational errors correctly", async () => {
    const mockErrors = [
      {
        id: "err-1",
        category: "notification",
        type: "reminder",
        error_message: "no_email",
        business_name: "המספרה",
        created_at: "2026-10-25T05:26:33Z",
      },
    ];

    const client = {
      rpc: (fn: string) => {
        expect(fn).toBe("admin_system_errors");
        return Promise.resolve({ data: mockErrors, error: null });
      },
    } as any;

    const errors = await getSystemErrors(client);
    expect(errors).toHaveLength(1);
    expect(errors[0].category).toBe("notification");
    expect(errors[0].error_message).toBe("no_email");
  });
});
