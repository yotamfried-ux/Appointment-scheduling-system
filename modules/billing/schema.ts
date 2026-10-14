import { z } from "zod";

/** Boundary check for what an adapter hands to the core: nothing reaches the database unvalidated. */
export const NormalizedEventSchema = z.object({
  eventId: z.string().min(1).max(200),
  type: z.enum(["subscription.updated", "subscription.canceled", "payment.failed", "payment.succeeded"]),
  occurredAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid date").transform((v) => new Date(v).toISOString()),
  businessId: z.string().uuid(),
  data: z
    .object({
      planId: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/).optional(),
      status: z.enum(["trialing", "active", "past_due", "canceled"]).optional(),
      currentPeriodEnd: z.string().refine((v) => !Number.isNaN(Date.parse(v))).optional(),
      cancelAtPeriodEnd: z.boolean().optional(),
      trialEnd: z.string().refine((v) => !Number.isNaN(Date.parse(v))).optional(),
      externalCustomerId: z.string().max(200).optional(),
      externalSubscriptionId: z.string().max(200).optional(),
    })
    .strict(),
});

export const CheckoutRequestBody = z.object({ planId: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/) }).strict();
