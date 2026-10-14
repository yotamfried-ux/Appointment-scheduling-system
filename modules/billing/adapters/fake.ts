import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookVerificationError, type BillingPort, type NormalizedEvent } from "@/modules/billing/ports";

// Development/CI provider. It behaves like a real one where it matters: a hosted "checkout" page, a signed webhook delivered
// separately from the owner's return, HMAC over the raw body with a timestamp (replay window), and provider-side event ids.
const TOLERANCE_SECONDS = 300;

export const signFakeWebhook = (secret: string, body: string, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

export function fakeBillingAdapter(secret: string): BillingPort {
  return {
    name: "fake",
    async createCheckout(req) {
      return { kind: "redirect", url: `/billing/fake-checkout?plan=${encodeURIComponent(req.planId)}` };
    },
    async createPortal(req) {
      return { url: `/billing/fake-checkout?portal=1&return=${encodeURIComponent(req.returnUrl)}` };
    },
    parseWebhook(rawBody, headers) {
      const header = headers.get("x-billing-signature") ?? "";
      const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header);
      if (!m) throw new WebhookVerificationError();
      const t = Number(m[1]);
      if (Math.abs(Math.floor(Date.now() / 1000) - t) > TOLERANCE_SECONDS) throw new WebhookVerificationError("stale"); // replay window
      const expected = createHmac("sha256", secret).update(`${m[1]}.${rawBody}`).digest();
      const got = Buffer.from(m[2], "hex");
      if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new WebhookVerificationError();
      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        throw new WebhookVerificationError("malformed");
      }
      const list = Array.isArray(json) ? json : [json];
      return list.map((e): NormalizedEvent => {
        const x = e as Partial<NormalizedEvent>;
        if (!x || typeof x.eventId !== "string" || typeof x.type !== "string" || typeof x.occurredAt !== "string" || typeof x.businessId !== "string") throw new WebhookVerificationError("malformed");
        return { eventId: x.eventId, type: x.type, occurredAt: x.occurredAt, businessId: x.businessId, data: x.data ?? {} };
      });
    },
  };
}
