"use server";

import { headers } from "next/headers";
import { enforce } from "@/modules/booking/public/rate-limit";
import { cancelWithToken, type CancelOutcome } from "@/modules/booking/public/service";

// POST (Server Action: Origin-checked, SEC-05). A link GET never changes state; this does, once per token (single-use jti).
export async function cancelAppointmentAction(cancelToken: unknown): Promise<CancelOutcome | "rate_limited"> {
  if (typeof cancelToken !== "string") return "invalid";
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
  try {
    await enforce([{ scope: "cancel-ip", value: ip, windowSeconds: 60, max: 20 }]);
  } catch {
    return "rate_limited";
  }
  return cancelWithToken(cancelToken);
}
