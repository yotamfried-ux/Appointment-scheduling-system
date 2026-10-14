import { WebhookVerificationError, type BillingPort } from "@/modules/billing/ports";

/** No payment provider connected: billing happens outside the system and a platform admin records it (BIL-09). Nothing here can be reached by a webhook. */
export function manualBillingAdapter(): BillingPort {
  return {
    name: "manual",
    async createCheckout() {
      return { kind: "manual", message: "החיוב מתבצע מולנו ישירות. שלחו לנו הודעה ונסדיר את המנוי." };
    },
    async createPortal() {
      return null;
    },
    parseWebhook() {
      throw new WebhookVerificationError("manual provider accepts no webhooks");
    },
  };
}
