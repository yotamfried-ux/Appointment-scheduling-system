import "server-only";
import { systemDb } from "@/platform/system-db";
import type { NormalizedEvent } from "@/modules/billing/ports";

export type ApplyOutcome = "applied" | "duplicate" | "stale" | "unknown_business" | "invalid_plan" | "invalid_status";

/** The ONLY path that changes subscription state: a verified, normalized event goes to the database, which orders and de-duplicates it (BIL-03). */
export async function applyBillingEvent(provider: string, e: NormalizedEvent): Promise<ApplyOutcome> {
  const { data, error } = await systemDb().rpc("billing_apply_event", {
    p_provider: provider,
    p_event_id: e.eventId,
    p_type: e.type,
    p_occurred_at: e.occurredAt,
    p_business: e.businessId,
    p_data: e.data,
  });
  if (error) throw new Error("billing event failed");
  return (data as { outcome: ApplyOutcome }).outcome;
}

/** Provider-side identifiers for checkout/portal (never readable by owners through the API). */
export async function subscriptionLinks(businessId: string): Promise<{ externalCustomerId: string | null }> {
  const { data } = await systemDb().rpc("billing_subscription_for", { p_business: businessId });
  return { externalCustomerId: (data as { externalCustomerId: string | null } | null)?.externalCustomerId ?? null };
}
