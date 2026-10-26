import { expect, test } from "@playwright/test";
import { admin, makeBusiness } from "./helpers/business";
import { drain, rows, runOutbox } from "./helpers/outbox";

// E2E Verification of Business Registration, Analytics Event & Admin Notification Outbox
// Verifies:
// 1. Business registration records domain event and triggers 'business_registered' analytics event
// 2. Outbox fan-out enqueues an 'admin_business_registered' notification for yotam.fried@gmail.com
// 3. Email is delivered with correct business metadata and zero customer PII
// 4. Repeated outbox runs remain strictly idempotent (no duplicate sends)
test.describe("business registration and admin notification outbox", () => {
  test("registering a new business records analytics and delivers admin notification via outbox", async ({ request }) => {
    const supabase = admin();
    const kind = "barber";

    // 1. Create a business (triggers create_business RPC, enqueue_event, and trg_businesses_analytics)
    const b = await makeBusiness(kind, { publish: true });
    expect(b.id).toBeDefined();
    expect(b.slug).toMatch(/^e2e-barber-/);

    // 2. Verify analytics event was automatically recorded in public.analytics_events
    const { data: analyticsEvents, error: analyticsError } = await supabase
      .from("analytics_events")
      .select("id, event_type, business_id, dedupe_key, meta, source")
      .eq("business_id", b.id)
      .eq("event_type", "business_registered");

    expect(analyticsError).toBeNull();
    expect(analyticsEvents).toHaveLength(1);
    expect(analyticsEvents![0].dedupe_key).toBe(`biz:${b.id}`);
    expect(analyticsEvents![0].meta).toMatchObject({
      kind,
      slug: b.slug,
    });

    // 3. Process the outbox job to fan-out and send notifications
    await drain(request, async () => {
      const rs = await rows(b, { includeAdmin: true });
      const regNotif = rs.find((r) => r.type === "admin_business_registered");
      return regNotif !== undefined && regNotif.status === "sent";
    });

    // 4. Inspect notification log record
    const rs = await rows(b, { includeAdmin: true });
    const regNotif = rs.find((r) => r.type === "admin_business_registered");
    expect(regNotif).toBeDefined();
    expect(regNotif!.status).toBe("sent");
    expect(regNotif!.recipient).toBe("admin");
    expect(regNotif!.attempts).toBe(1);
    expect(regNotif!.provider_message_id).toMatch(/^fake_notif-/);

    // 5. Verify email payload and safety
    expect(regNotif!.preview).toBeDefined();
    expect(regNotif!.preview!.to).toBe("yotam.fried@gmail.com");
    expect(regNotif!.preview!.subject).toContain("עסק חדש נרשם למערכת");
    expect(regNotif!.preview!.text).toContain(b.slug);
    expect(regNotif!.preview!.text).toContain("/admin");
    // Ensure zero customer PII leakage
    expect(regNotif!.preview!.text).not.toContain("customer_password");
    expect(regNotif!.preview!.text).not.toContain("SECRET");

    // 6. Verify idempotency: running outbox again does not create or send duplicate alerts
    await runOutbox(request);
    await runOutbox(request);

    const rsAfter = await rows(b, { includeAdmin: true });
    const regNotifsAfter = rsAfter.filter((r) => r.type === "admin_business_registered");
    expect(regNotifsAfter).toHaveLength(1);
    expect(regNotifsAfter[0].attempts).toBe(1);
  });
});
