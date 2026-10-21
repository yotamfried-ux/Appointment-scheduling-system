"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { ipFromHeaders } from "@/lib/client-ip";
import { enforce } from "@/modules/booking/public/rate-limit";
import { cancelWithToken, confirmAttendanceWithToken, rescheduleWithToken, type AttendOutcome, type CancelOutcome, type RescheduleOutcome } from "@/modules/booking/public/service";
import { signToken, verifyToken } from "@/modules/booking/token";
import { kickOutbox } from "@/modules/notifications/service";

// POST (Server Action: Origin-checked, SEC-05). A link GET never changes state; this does, once per token (single-use jti).
export async function cancelAppointmentAction(cancelToken: unknown): Promise<CancelOutcome | "rate_limited"> {
  if (typeof cancelToken !== "string") return "invalid";
  const h = await headers();
  const ip = ipFromHeaders(h);
  try {
    await enforce([{ scope: "cancel-ip", value: ip, windowSeconds: 60, max: 20 }]);
  } catch {
    return "rate_limited";
  }
  const outcome = await cancelWithToken(cancelToken);
  if (outcome === "cancelled") after(kickOutbox);
  return outcome;
}

/** RSC-01: POST (Server Action: Origin-checked). Returns a fresh token after a refusal that leaves the move possible. */
export async function rescheduleAppointmentAction(rescheduleToken: unknown, date: unknown, time: unknown, serviceId?: unknown): Promise<{ outcome: RescheduleOutcome | "rate_limited"; nextToken?: string }> {
  if (typeof rescheduleToken !== "string" || typeof date !== "string" || typeof time !== "string") return { outcome: "invalid" };
  const h = await headers();
  const ip = ipFromHeaders(h);
  try {
    await enforce([{ scope: "resched-ip", value: ip, windowSeconds: 60, max: 20 }]);
  } catch {
    return { outcome: "rate_limited" };
  }
  const outcome = await rescheduleWithToken(rescheduleToken, date, time, typeof serviceId === "string" ? serviceId : undefined);
  if (outcome === "moved") after(kickOutbox);
  const v = verifyToken(rescheduleToken, "reschedule");
  const retryable = outcome === "slot_taken" || outcome === "invalid_slot";
  return { outcome, ...(retryable && v.ok ? { nextToken: signToken({ appointmentId: v.payload.a, scope: "reschedule", ttlSeconds: 3600 }) } : {}) };
}

/** NSH-01: POST (Server Action: Origin-checked). Never changes the appointment's status. */
export async function confirmAttendanceAction(attendToken: unknown): Promise<AttendOutcome | "rate_limited"> {
  if (typeof attendToken !== "string") return "invalid";
  const h = await headers();
  const ip = ipFromHeaders(h);
  try {
    await enforce([{ scope: "attend-ip", value: ip, windowSeconds: 60, max: 20 }]);
  } catch {
    return "rate_limited";
  }
  return confirmAttendanceWithToken(attendToken);
}
