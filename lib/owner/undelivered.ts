import type { FailureCode } from "@/lib/api/contracts";

const KINDS = new Set(["booking_received", "booking_confirmed", "booking_declined", "booking_cancelled_by_business", "booking_cancelled_by_customer", "reminder", "booking_rescheduled", "booking_moved_by_business", "waitlist_offer", "waitlist_offer_expired"]);

/** The message key (owner.agenda.kind.*) for a notification type; anything unexpected reads as a plain "message". */
export const kindKey = (type: string): string => (KINDS.has(type) ? type : "other");

const REASONS: Record<FailureCode, string> = {
  provider_rejected: "provider_rejected",
  bounced: "bounced",
  no_email: "no_email",
  rate_limited: "rate_limited",
  unknown: "unknown",
};
/** The message key (owner.agenda.reason.*) for a failure code; a code this build does not know reads as "unknown". */
export const reasonKey = (code: string): string => REASONS[code as FailureCode] ?? "unknown";

/** Failures the owner should act on, and the rows where there was simply nobody to send to. */
export function splitUndelivered<T extends { code: string }>(items: readonly T[]): { failed: T[]; noEmail: T[] } {
  return { failed: items.filter((i) => i.code !== "no_email"), noEmail: items.filter((i) => i.code === "no_email") };
}
