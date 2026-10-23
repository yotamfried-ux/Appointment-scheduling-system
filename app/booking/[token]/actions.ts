"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { ipFromHeaders } from "@/lib/client-ip";
import { enforce } from "@/modules/booking/public/rate-limit";
import { cancelWithToken, confirmAttendanceWithToken, rescheduleWithToken, type AttendOutcome, type CancelOutcome, type RescheduleOutcome } from "@/modules/booking/public/service";
import { kickOutbox } from "@/modules/notifications/service";

// POST (Server Action: Origin-checked, SEC-05). A link GET never changes state; these do. They present the customer's link itself ("view" scope): the page carries no other token (VULN-0022).
export async function cancelAppointmentAction(token: unknown): Promise<CancelOutcome | "rate_limited"> {
  if (typeof token !== "string") return "invalid";
  const h = await headers();
  const ip = ipFromHeaders(h);
  try {
    await enforce([{ scope: "cancel-ip", value: ip, windowSeconds: 60, max: 20 }]);
  } catch {
    return "rate_limited";
  }
  const outcome = await cancelWithToken(token);
  if (outcome === "cancelled") after(kickOutbox);
  return outcome;
}

/** RSC-01: POST (Server Action: Origin-checked). */
export async function rescheduleAppointmentAction(token: unknown, date: unknown, time: unknown, serviceId?: unknown): Promise<{ outcome: RescheduleOutcome | "rate_limited" }> {
  if (typeof token !== "string" || typeof date !== "string" || typeof time !== "string") return { outcome: "invalid" };
  const h = await headers();
  const ip = ipFromHeaders(h);
  try {
    await enforce([{ scope: "resched-ip", value: ip, windowSeconds: 60, max: 20 }]);
  } catch {
    return { outcome: "rate_limited" };
  }
  const outcome = await rescheduleWithToken(token, date, time, typeof serviceId === "string" ? serviceId : undefined);
  if (outcome === "moved") after(kickOutbox);
  return { outcome };
}

/** NSH-01: POST (Server Action: Origin-checked). Never changes the appointment's status. */
export async function confirmAttendanceAction(token: unknown): Promise<AttendOutcome | "rate_limited"> {
  if (typeof token !== "string") return "invalid";
  const h = await headers();
  const ip = ipFromHeaders(h);
  try {
    await enforce([{ scope: "attend-ip", value: ip, windowSeconds: 60, max: 20 }]);
  } catch {
    return "rate_limited";
  }
  return confirmAttendanceWithToken(token);
}
