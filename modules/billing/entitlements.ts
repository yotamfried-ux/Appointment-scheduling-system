import "server-only";
import { fail } from "@/lib/api/http";
import type { OwnerCtx } from "@/modules/booking/owner/service";

// The code asks "can this business do X", never "is the plan Pro" (docs/03 §6). The answer is computed once, in SQL (`my_billing`).
export type FeatureKey = "waitlist" | "export";
export type SubscriptionState = "trial" | "active" | "grace" | "degraded";

export interface MyBilling {
  state: SubscriptionState;
  status: "trialing" | "active" | "past_due" | "canceled";
  planId: string;
  planName: string;
  priceCents: number;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  graceUntil: string | null;
  provider: string | null;
  features: Record<FeatureKey, boolean>;
  limits: { maxServices: number | null };
  usage: { services: number };
  overrides: { key: string; reason: string; expiresAt: string | null }[];
}

export async function myBilling(ctx: OwnerCtx): Promise<MyBilling> {
  const { data, error } = await ctx.supabase.rpc("my_billing", { p_business: ctx.business.id });
  if (error || !data) throw new Error("billing unavailable");
  return data as MyBilling;
}

/** BIL-08: one uniform answer (402) for a feature the plan does not include; the data stays, the UI shows an upsell. */
export async function requireFeature(ctx: OwnerCtx, key: FeatureKey): Promise<void> {
  if (!(await myBilling(ctx)).features[key]) throw fail("PAYMENT_REQUIRED", "התכונה הזו אינה כלולה במנוי הנוכחי.");
}

/** Whole days left until an instant (rounded up); kept out of components so rendering stays pure. */
export const daysUntil = (iso: string, now = Date.now()) => Math.ceil((Date.parse(iso) - now) / 86_400_000);
