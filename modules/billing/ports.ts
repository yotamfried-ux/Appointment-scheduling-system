// The subscription provider as a port (docs/00 D4/D22). The core (tables, state machine, entitlements) knows no provider:
// an adapter only translates three things — "send the owner to pay", "send the owner to manage", and "what a webhook means".
// Adding a real provider = one adapter file implementing this interface and registering it in config.ts.
export type BillingEventType = "subscription.updated" | "subscription.canceled" | "payment.failed" | "payment.succeeded";

/** What every provider's webhook is reduced to. The database decides what it means (order, duplicates, state). */
export interface NormalizedEvent {
  /** Unique per provider; the database refuses to apply the same id twice (BIL-03). */
  eventId: string;
  type: BillingEventType;
  /** When it happened at the provider (not when it arrived): events are ordered by this. */
  occurredAt: string;
  /** Our business id, carried through checkout as provider metadata. */
  businessId: string;
  data: {
    planId?: string;
    status?: "trialing" | "active" | "past_due" | "canceled";
    currentPeriodEnd?: string;
    cancelAtPeriodEnd?: boolean;
    trialEnd?: string;
    externalCustomerId?: string;
    externalSubscriptionId?: string;
  };
}

export interface CheckoutRequest {
  businessId: string;
  planId: string;
  /** Absolute URLs the provider sends the owner back to. Returning NEVER changes the subscription — only the webhook does (BIL-04). */
  returnUrl: string;
  customerEmail?: string;
  externalCustomerId?: string | null;
}

export type CheckoutResult = { kind: "redirect"; url: string } | { kind: "manual"; message: string };

export interface BillingPort {
  readonly name: "fake" | "manual";
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /** Where the owner updates the card / cancels / sees invoices; null when the provider has no such page. */
  createPortal(req: { businessId: string; returnUrl: string; externalCustomerId?: string | null }): Promise<{ url: string } | null>;
  /** Verifies the signature over the RAW body and returns normalized events. Throws WebhookVerificationError on anything doubtful. */
  parseWebhook(rawBody: string, headers: Headers): NormalizedEvent[];
}

export class WebhookVerificationError extends Error {
  constructor(message = "webhook verification failed") {
    super(message);
    this.name = "WebhookVerificationError";
  }
}
