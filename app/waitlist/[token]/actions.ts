"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { ipFromHeaders } from "@/lib/client-ip";
import { enforce } from "@/modules/booking/public/rate-limit";
import { kickOutbox } from "@/modules/notifications/service";
import { acceptOffer, declineOffer, leaveWaitlist, type WaitlistActionOutcome } from "@/modules/waitlist/public";

// POST (Server Action: Origin-checked). A link GET only shows; each action link is single-use (SEC-05/06).
export async function waitlistAction(kind: "accept" | "decline" | "leave", token: unknown): Promise<WaitlistActionOutcome | "rate_limited"> {
  if (typeof token !== "string") return "invalid";
  const h = await headers();
  const ip = ipFromHeaders(h);
  try {
    await enforce([{ scope: "wl-action-ip", value: ip, windowSeconds: 60, max: 20 }]);
  } catch {
    return "rate_limited";
  }
  const outcome = await (kind === "accept" ? acceptOffer(token) : kind === "decline" ? declineOffer(token) : leaveWaitlist(token));
  if (outcome === "accepted" || outcome === "declined" || outcome === "left") after(kickOutbox); // confirmation / next offer go out now
  return outcome;
}
