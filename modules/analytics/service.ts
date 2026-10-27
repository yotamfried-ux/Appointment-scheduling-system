import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalyticsEventType } from "./types";

/**
 * Privacy invariant: Analytics events must never store personal data (PII) of end-customers.
 * Strip out common PII fields before sending to the database.
 */
export function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...payload };
  const forbiddenKeys = ["email", "phone", "name", "fullName", "full_name", "customer_name", "customer_email", "customer_phone"];
  for (const key of forbiddenKeys) {
    if (key in sanitized) {
      delete sanitized[key];
    }
  }
  return sanitized;
}

export async function recordAnalyticsEvent(
  supabase: SupabaseClient,
  params: {
    businessId: string;
    eventType: AnalyticsEventType;
    eventTarget?: string | null;
    payload?: Record<string, unknown>;
  }
): Promise<boolean> {
  try {
    const cleanPayload = sanitizePayload(params.payload ?? {});
    const { error } = await supabase.from("analytics_events").insert({
      business_id: params.businessId,
      event_type: params.eventType,
      meta: cleanPayload,
    });
    return !error;
  } catch {
    return false;
  }
}
