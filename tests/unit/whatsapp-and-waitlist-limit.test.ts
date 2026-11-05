import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { OwnerWaitlistSettingsRequest } from "@/lib/api/contracts";
import { fakeWhatsAppAdapter } from "@/modules/notifications/adapters/fake-whatsapp";
import {
  metaWhatsAppAdapter,
  toWhatsAppRecipient,
  verifyWhatsAppConnection,
  whatsappProviderReason,
} from "@/modules/notifications/adapters/whatsapp";
import { whatsappProvider } from "@/modules/notifications/config";
import { PermanentEmailError, TransientEmailError } from "@/modules/notifications/ports";
import { renderWhatsApp, type NotifContext } from "@/modules/notifications/templates";
import { BookingRulesInput } from "@/modules/tenancy/booking-rules";

const baseCtx = (over: Partial<NotifContext> = {}): NotifContext => ({
  type: "booking_confirmed",
  recipient: "customer",
  appointment: {
    id: "00000000-0000-0000-0000-000000000001",
    status: "confirmed",
    startsAt: "2026-11-10T08:00:00Z",
    endsAt: "2026-11-10T08:30:00Z",
    reference: "TR-WA1234",
    serviceName: "תספורת גברים",
    location: "business",
    personName: "דניאל",
  },
  offer: null,
  business: {
    name: "מספרת הדר",
    slug: "hadar",
    kind: "barber",
    timezone: "Asia/Jerusalem",
    phone: "+972501234567",
    whatsappEnabled: false,
  },
  customer: {
    name: "נועה לוי",
    email: "noa@example.com",
    phone: "+972529876543",
  },
  owner: {
    email: "owner@example.com",
  },
  ...over,
});

describe("WhatsApp configuration & default-disabled guarantee", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled by default when WHATSAPP_PROVIDER is unset", () => {
    vi.stubEnv("WHATSAPP_PROVIDER", "");
    const p = whatsappProvider();
    expect(p.name).toBe("disabled");
  });

  it("refuses the fake WhatsApp provider in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WHATSAPP_PROVIDER", "fake");
    expect(() => whatsappProvider()).toThrow(/not allowed in production/);
  });

  it("requires WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID when WHATSAPP_PROVIDER=meta", () => {
    vi.stubEnv("WHATSAPP_PROVIDER", "meta");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "");
    expect(() => whatsappProvider()).toThrow(/WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID/);

    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "EAA_test_token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123456789012345");
    expect(whatsappProvider().name).toBe("meta");
  });
});

describe("Meta WhatsApp Cloud API adapter & phone normalization", () => {
  it("normalizes Israeli local and E.164 phone numbers to digits-only for Meta API", () => {
    expect(toWhatsAppRecipient("052-987-6543")).toBe("972529876543");
    expect(toWhatsAppRecipient("+972501234567")).toBe("972501234567");
    expect(toWhatsAppRecipient("invalid")).toBeNull();
  });

  it("sends text and template messages via Meta Graph API and returns wamid", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchMock: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return new Response(
        JSON.stringify({
          messaging_product: "whatsapp",
          contacts: [{ input: "972529876543", wa_id: "972529876543" }],
          messages: [{ id: "wamid.HBgMOTcyNTI5ODc2NTQzFQIAERgSQkM0" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const adapter = metaWhatsAppAdapter({
      accessToken: "EAA_test_meta_token",
      phoneNumberId: "109876543210",
      apiVersion: "v21.0",
      fetchImpl: fetchMock,
    });

    const textRes = await adapter.send({
      to: "052-9876543",
      body: "שלום נועה, התור שלך אושר.",
      idempotencyKey: "k1",
      attempt: 1,
    });
    expect(textRes.id).toBe("wamid.HBgMOTcyNTI5ODc2NTQzFQIAERgSQkM0");
    expect(calls[0].url).toBe("https://graph.facebook.com/v21.0/109876543210/messages");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "972529876543",
      type: "text",
      text: { preview_url: false, body: "שלום נועה, התור שלך אושר." },
    });

    await adapter.send({
      to: "+972529876543",
      body: "fallback",
      template: {
        name: "appointment_confirmed",
        languageCode: "he",
        bodyParams: ["נועה לוי", "מספרת הדר", "יום שלישי בשעה 10:00"],
      },
      idempotencyKey: "k2",
      attempt: 1,
    });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "972529876543",
      type: "template",
      template: {
        name: "appointment_confirmed",
        language: { code: "he" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "נועה לוי" },
              { type: "text", text: "מספרת הדר" },
              { type: "text", text: "יום שלישי בשעה 10:00" },
            ],
          },
        ],
      },
    });
  });

  it("maps 429 / 5xx / 401 to TransientEmailError and 400 to PermanentEmailError while scrubbing PII", async () => {
    const reason = whatsappProviderReason(400, {
      error: {
        type: "OAuthException",
        code: 131030,
        message: "Recipient +972529876543 (noa@example.com) with token EAAf4C13bnIoBSyNft not in allowed list",
      },
    });
    expect(reason).not.toContain("972529876543");
    expect(reason).not.toContain("noa@example.com");
    expect(reason).not.toContain("EAAf4C13bnIoBSyNft");
    expect(reason).toContain("[phone]");
    expect(reason).toContain("[address]");
    expect(reason).toContain("[token]");

    const adapter429 = metaWhatsAppAdapter({
      accessToken: "EAA_test",
      phoneNumberId: "109876543210",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { type: "OAuthException", code: 130429, message: "Rate limit hit" } }), {
          status: 429,
          headers: { "Retry-After": "45" },
        }),
    });
    await expect(
      adapter429.send({ to: "+972529876543", body: "בדיקה", idempotencyKey: "k429", attempt: 1 }),
    ).rejects.toMatchObject({
      name: "TransientEmailError",
      retryAfterSeconds: 45,
    });

    const adapter400 = metaWhatsAppAdapter({
      accessToken: "EAA_test",
      phoneNumberId: "109876543210",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { type: "OAuthException", code: 100, message: "Invalid parameter" } }), {
          status: 400,
        }),
    });
    await expect(
      adapter400.send({ to: "+972529876543", body: "בדיקה", idempotencyKey: "k400", attempt: 1 }),
    ).rejects.toBeInstanceOf(PermanentEmailError);
  });

  it("verifies Meta System User token and scopes via verifyWhatsAppConnection", async () => {
    const res = await verifyWhatsAppConnection({
      accessToken: "EAA_valid",
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes("/me")) {
          return new Response(JSON.stringify({ id: "122103546057533292", name: "d2r-api-user" }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            data: {
              app_id: "2243052539976842",
              application: "d2r",
              type: "SYSTEM_USER",
              is_valid: true,
              scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
            },
          }),
          { status: 200 },
        );
      },
    });
    expect(res.ok).toBe(true);
    expect(res.userName).toBe("d2r-api-user");
    expect(res.application).toBe("d2r");
    expect(res.scopes).toContain("whatsapp_business_messaging");
  });

  it("fakeWhatsAppAdapter captures messages and injects deterministic failures", async () => {
    const fake = fakeWhatsAppAdapter();
    const ok = await fake.send({ to: "+972529876543", body: "שלום", idempotencyKey: "sim-1", attempt: 1 });
    expect(ok.id).toBe("wamid.fake_sim-1");
    expect(fake.sent).toHaveLength(1);

    await expect(
      fake.send({ to: "+972500000500", body: "שלום", idempotencyKey: "sim-500", attempt: 1 }),
    ).rejects.toBeInstanceOf(TransientEmailError);
    await expect(
      fake.send({ to: "+972500000501", body: "שלום", idempotencyKey: "sim-501", attempt: 1 }),
    ).rejects.toBeInstanceOf(TransientEmailError);
    await expect(
      fake.send({ to: "+972500000501", body: "שלום", idempotencyKey: "sim-501", attempt: 2 }),
    ).resolves.toEqual({ id: "wamid.fake_sim-501" });
    await expect(
      fake.send({ to: "+972500000400", body: "שלום", idempotencyKey: "sim-400", attempt: 1 }),
    ).rejects.toBeInstanceOf(PermanentEmailError);
  });
});

describe("WhatsApp template rendering & privacy rules", () => {
  it("renders Hebrew WhatsApp messages with modality and links for customer and owner", () => {
    const confirmed = renderWhatsApp(baseCtx(), { appUrl: "https://turim.d2ryf.com", manageToken: "tok123" });
    expect(confirmed).toContain("*מספרת הדר*");
    expect(confirmed).toContain("התור אושר.");
    expect(confirmed).toContain("תספורת גברים");
    expect(confirmed).toContain("*אופן מפגש:* פרונטלי");
    expect(confirmed).toContain("*אצל:* דניאל");
    expect(confirmed).toContain("TR-WA1234");
    expect(confirmed).toContain("https://turim.d2ryf.com/booking/tok123?confirm=1");

    const online = renderWhatsApp(
      baseCtx({
        appointment: { ...baseCtx().appointment!, location: "online" },
      }),
      { appUrl: "https://turim.d2ryf.com", manageToken: "tok123" },
    );
    expect(online).toContain("*אופן מפגש:* אונליין");
  });

  it("hides service names in WhatsApp messages for privacy-sensitive business kinds (clinic, beauty, nails)", () => {
    for (const kind of ["clinic", "beauty", "nails"] as const) {
      const secret = "טיפול פסיכולוגי רגיש";
      const wa = renderWhatsApp(
        baseCtx({
          business: { ...baseCtx().business, kind },
          appointment: { ...baseCtx().appointment!, serviceName: secret },
        }),
        { appUrl: "https://turim.d2ryf.com", manageToken: "tok123" },
      );
      expect(wa).not.toContain(secret);
    }
  });
});

describe("Waitlist daily limit validation (uniform across working days)", () => {
  const validRules = {
    requiresApproval: false,
    cancelUntilHours: 12,
    minNoticeMinutes: 60,
    horizonDays: 60,
    address: "הרצל 10",
    noShowPolicy: "off" as const,
    noShowThreshold: 3,
    blockMessage: "",
    attendanceAlertMinutes: 0,
    autoCompleteHours: null,
    digestFrequency: "off" as const,
    rescheduleServiceChange: false,
  };

  it("defaults waitlistDailyLimit to null (unlimited) and whatsappEnabled to false (not default)", () => {
    const parsed = BookingRulesInput.parse(validRules);
    expect(parsed.waitlistDailyLimit).toBeNull();
    expect(parsed.whatsappEnabled).toBe(false);
  });

  it("accepts valid daily waitlist limits (1..500) and rejects 0, negative, or >500", () => {
    expect(BookingRulesInput.safeParse({ ...validRules, waitlistDailyLimit: 1 }).success).toBe(true);
    expect(BookingRulesInput.safeParse({ ...validRules, waitlistDailyLimit: 15 }).success).toBe(true);
    expect(BookingRulesInput.safeParse({ ...validRules, waitlistDailyLimit: 500 }).success).toBe(true);
    expect(BookingRulesInput.safeParse({ ...validRules, waitlistDailyLimit: null }).success).toBe(true);

    expect(BookingRulesInput.safeParse({ ...validRules, waitlistDailyLimit: 0 }).success).toBe(false);
    expect(BookingRulesInput.safeParse({ ...validRules, waitlistDailyLimit: -3 }).success).toBe(false);
    expect(BookingRulesInput.safeParse({ ...validRules, waitlistDailyLimit: 501 }).success).toBe(false);
  });

  it("allows updating dailyLimit in OwnerWaitlistSettingsRequest", () => {
    expect(OwnerWaitlistSettingsRequest.safeParse({ dailyLimit: 10 }).success).toBe(true);
    expect(OwnerWaitlistSettingsRequest.safeParse({ dailyLimit: null }).success).toBe(true);
    expect(OwnerWaitlistSettingsRequest.safeParse({ dailyLimit: 0 }).success).toBe(false);
    expect(OwnerWaitlistSettingsRequest.safeParse({}).success).toBe(false);
  });
});
