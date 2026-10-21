import { describe, expect, it } from "vitest";
import { fakeBillingAdapter, signFakeWebhook } from "@/modules/billing/adapters/fake";
import { manualBillingAdapter } from "@/modules/billing/adapters/manual";
import { WebhookVerificationError } from "@/modules/billing/ports";
import { CheckoutRequestBody, NormalizedEventSchema } from "@/modules/billing/schema";

const SECRET = "unit-test-secret-0123456789";
const BIZ = "3f4d48ff-31d4-43a7-9f7c-1a171e7b63ff";
const adapter = fakeBillingAdapter(SECRET);
const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ eventId: "evt_1", type: "subscription.updated", occurredAt: "2026-06-01T10:00:00Z", businessId: BIZ, data: { planId: "pro", status: "active" }, ...over });
const headers = (b: string, secret = SECRET, t?: number) => new Headers({ "x-billing-signature": signFakeWebhook(secret, b, t) });

describe("fake provider webhook verification (BIL-03)", () => {
  it("accepts a correctly signed body and normalizes it", () => {
    const b = body();
    const [e] = adapter.parseWebhook(b, headers(b));
    expect(e).toMatchObject({ eventId: "evt_1", type: "subscription.updated", businessId: BIZ, data: { planId: "pro", status: "active" } });
  });
  it("accepts a batch", () => {
    const b = `[${body()},${body({ eventId: "evt_2" })}]`;
    expect(adapter.parseWebhook(b, headers(b)).map((e) => e.eventId)).toEqual(["evt_1", "evt_2"]);
  });
  it("rejects a wrong secret, a tampered body, a missing or malformed header", () => {
    const b = body();
    expect(() => adapter.parseWebhook(b, headers(b, "another-secret-another-secret"))).toThrow(WebhookVerificationError);
    expect(() => adapter.parseWebhook(b.replace("pro", "starter"), headers(b))).toThrow(WebhookVerificationError);
    expect(() => adapter.parseWebhook(b, new Headers())).toThrow(WebhookVerificationError);
    for (const bad of ["", "v1=abc", "t=1,v1=zz", `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`]) {
      expect(() => adapter.parseWebhook(b, new Headers({ "x-billing-signature": bad }))).toThrow(WebhookVerificationError);
    }
  });
  it("rejects a replay outside the time window, in both directions", () => {
    const b = body();
    const now = Math.floor(Date.now() / 1000);
    expect(() => adapter.parseWebhook(b, headers(b, SECRET, now - 301))).toThrow(WebhookVerificationError);
    expect(() => adapter.parseWebhook(b, headers(b, SECRET, now + 301))).toThrow(WebhookVerificationError);
    expect(adapter.parseWebhook(b, headers(b, SECRET, now - 60))).toHaveLength(1);
  });
  it("rejects a correctly signed but malformed payload", () => {
    for (const b of ["not json", JSON.stringify({ hello: "world" }), JSON.stringify({ eventId: 1 })]) expect(() => adapter.parseWebhook(b, headers(b))).toThrow(WebhookVerificationError);
  });
  it("the signature covers the timestamp: reusing a signature with another time fails", () => {
    const b = body();
    const now = Math.floor(Date.now() / 1000);
    const sig = signFakeWebhook(SECRET, b, now).replace(`t=${now}`, `t=${now + 1}`);
    expect(() => adapter.parseWebhook(b, new Headers({ "x-billing-signature": sig }))).toThrow(WebhookVerificationError);
  });
});

describe("event boundary validation", () => {
  const ok = { eventId: "e", type: "payment.failed", occurredAt: "2026-06-01T10:00:00+02:00", businessId: BIZ, data: {} };
  it("normalizes the timestamp to UTC ISO", () => expect(NormalizedEventSchema.parse(ok).occurredAt).toBe("2026-06-01T08:00:00.000Z"));
  it("refuses what the database must never see", () => {
    for (const bad of [{ ...ok, businessId: "not-a-uuid" }, { ...ok, type: "refund.made" }, { ...ok, occurredAt: "yesterday" }, { ...ok, eventId: "" }, { ...ok, data: { planId: "Pro; drop table" } }, { ...ok, data: { status: "paused" } }, { ...ok, data: { extra: 1 } }]) {
      expect(NormalizedEventSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it("checkout accepts a plan id and nothing else", () => {
    expect(CheckoutRequestBody.safeParse({ planId: "pro" }).success).toBe(true);
    expect(CheckoutRequestBody.safeParse({ planId: "pro", price: 0 }).success).toBe(false);
    expect(CheckoutRequestBody.safeParse({ planId: "../x" }).success).toBe(false);
  });
});

describe("adapters", () => {
  it("fake: checkout is a redirect to the hosted page, portal exists", async () => {
    expect(await adapter.createCheckout({ businessId: BIZ, planId: "pro", returnUrl: "http://x/y" })).toEqual({ kind: "redirect", url: "/billing/fake-checkout?plan=pro" });
    expect((await adapter.createPortal({ businessId: BIZ, returnUrl: "http://x/y" }))?.url).toContain("/billing/fake-checkout");
  });
  it("manual: no checkout, no portal, and no webhook is ever accepted", async () => {
    const m = manualBillingAdapter();
    expect((await m.createCheckout({ businessId: BIZ, planId: "pro", returnUrl: "" })).kind).toBe("manual");
    expect(await m.createPortal({ businessId: BIZ, returnUrl: "" })).toBeNull();
    const b = body();
    expect(() => m.parseWebhook(b, headers(b))).toThrow(WebhookVerificationError);
  });
});
