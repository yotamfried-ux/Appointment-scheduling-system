import type { NotificationType } from "@/modules/notifications/templates";

export interface PlannedNotification {
  type: NotificationType;
  recipient: "customer" | "owner";
}

export interface OutboxEvent {
  type: string;
  payload: Record<string, unknown>;
}

/** Which messages does a domain event call for? Pure, so the whole mapping is unit-tested. Unknown events plan nothing. */
export function plan(event: OutboxEvent, appointmentStatus: string | null): PlannedNotification[] {
  switch (event.type) {
    case "AppointmentCreated":
      if (appointmentStatus === "pending")
        return [
          { type: "booking_received", recipient: "customer" },
          { type: "owner_new_request", recipient: "owner" },
        ];
      if (appointmentStatus === "confirmed") return [{ type: "booking_confirmed", recipient: "customer" }];
      return [];
    case "AppointmentCancelled": // the customer cancelled through their link
      return [
        { type: "booking_cancelled_by_customer", recipient: "customer" },
        { type: "owner_customer_cancelled", recipient: "owner" },
      ];
    case "AppointmentRescheduled": // the customer moved their appointment through their link
      return [
        { type: "booking_rescheduled", recipient: "customer" },
        { type: "owner_customer_rescheduled", recipient: "owner" },
      ];
    case "AppointmentMovedByBusiness": // the owner moved the booking: tell the customer (they may decline)
      return [{ type: "booking_moved_by_business", recipient: "customer" }];
    case "AppointmentStatusChanged": {
      switch (event.payload.action) {
        case "approve":
        case "decline_cancellation":
          return [{ type: "booking_confirmed", recipient: "customer" }];
        case "reject":
          return [{ type: "booking_declined", recipient: "customer" }];
        case "cancel":
          return [{ type: "booking_cancelled_by_business", recipient: "customer" }];
        case "approve_cancellation":
          return [{ type: "booking_cancelled_by_customer", recipient: "customer" }];
        default:
          return [];
      }
    }
    default:
      return [];
  }
}

/** NTF-03: check before sending. Returns a skip reason when the world has changed since the message was queued. (`status`/`startsAtIso` describe the appointment, or the offer for waitlist messages.) */
export function staleReason(type: NotificationType, status: string, startsAtIso: string, now: Date): string | null {
  const ok = (cond: boolean) => (cond ? null : "appointment_inactive");
  switch (type) {
    case "reminder":
      return ok(status === "confirmed" && new Date(startsAtIso) > now);
    case "booking_confirmed":
      return ok(status === "confirmed" || status === "completed");
    case "booking_received": // once decided, the decision message supersedes it
    case "owner_new_request": // nothing left to decide
      return ok(status === "pending");
    case "booking_declined":
    case "booking_cancelled_by_business":
      return ok(status === "cancelled_by_business");
    case "booking_cancelled_by_customer":
    case "owner_customer_cancelled":
      return ok(status === "cancelled_by_customer");
    case "booking_moved_by_business":
      return ok(status === "confirmed" || status === "pending");
    case "owner_unconfirmed": // the visit is still ahead and still unconfirmed by the customer
      return ok(status === "confirmed" && new Date(startsAtIso) > now);
    case "owner_digest":
      return null;
    case "booking_rescheduled":
    case "owner_customer_rescheduled":
      return ok(status === "confirmed" || status === "pending");
    case "waitlist_offer": // `status` is the offer's status: only a live offer is worth announcing
      return ok(status === "pending" && new Date(startsAtIso) > now);
    case "waitlist_offer_expired":
      return ok(status === "expired");
  }
}
