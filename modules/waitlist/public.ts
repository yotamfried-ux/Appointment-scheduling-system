import "server-only";
// Customer side of the waitlist (system path). Hours are not checked here: a waitlist is for days that are FULL; offers only ever
// reuse a slot that was just freed by a real booking, and accepting goes through the same EXCLUDE as any booking.
import { createHash } from "node:crypto";
import type { z } from "zod";
import type * as C from "@/lib/api/contracts";
import { fail } from "@/lib/api/http";
import { normalizePhone } from "@/lib/phone";
import { signToken, verifyToken } from "@/modules/booking/token";
import { computeAvailability, type Catalog } from "@/modules/booking/public/service";
import { systemDb } from "@/platform/system-db";
import { systemClock, zonedParts } from "@/platform/clock";

const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const dayEndUtc = (date: string) => Date.parse(`${date}T23:59:59Z`);

/** `idemKey` is the caller's proof of having created the entry: only that caller gets the manage link back (a stranger replaying a phone number gets none). */
export async function joinWaitlist(c: Catalog, input: C.JoinWaitlistInput, idemKey: string | null): Promise<z.infer<typeof C.JoinWaitlistResponse>> {
  if (!c.business.waitlistEnabled) throw fail("NOT_FOUND", "רשימת ההמתנה אינה פעילה בעסק הזה.");
  const phone = normalizePhone(input.customer.phone);
  if (!phone) throw fail("VALIDATION_FAILED", "הבקשה אינה תקינה.", [{ field: "customer.phone", message: "מספר הטלפון אינו תקין." }]);
  const svc = c.services.find((s) => s.id === input.serviceId);
  if (!svc) throw fail("SERVICE_UNAVAILABLE", "השירות כבר אינו זמין. בחרו שירות אחר.");
  const today = zonedParts(systemClock.now(), c.business.timezone).date;
  if (input.date < today) throw fail("VALIDATION_FAILED", "הבקשה אינה תקינה.", [{ field: "date", message: "אי אפשר להצטרף ליום שעבר." }]);
  // A day the business is closed can never free up a slot: refuse it instead of keeping the customer waiting for nothing.
  const day = (await computeAvailability(c, svc.id, input.date, 1)).days[0];
  if (day?.closed) throw fail("VALIDATION_FAILED", "הבקשה אינה תקינה.", [{ field: "date", message: "העסק סגור ביום הזה. בחרו יום אחר." }]);
  const { data, error } = await systemDb().rpc("waitlist_join", {
    p_business: c.business.id,
    p_service: svc.id,
    p_date: input.date,
    p_from: input.window ? minutesOf(input.window.from) : null,
    p_to: input.window ? minutesOf(input.window.to) : null,
    p_full_name: input.customer.fullName.trim(),
    p_phone: phone,
    p_email: input.customer.email.trim(),
    p_terms_version: input.acceptedTerms.terms,
    p_privacy_version: input.acceptedTerms.privacy,
    p_idem_hash: idemKey ? createHash("sha256").update(`${c.business.id}|${idemKey}`).digest("hex") : null,
  });
  if (error) throw mapJoinError(error);
  const r = data as { replay: boolean; id: string; owner: boolean };
  const ttl = Math.max(3600, Math.floor((dayEndUtc(input.date) - Date.now()) / 1000) + 3 * 86_400);
  if (r.replay && !r.owner) return { replay: true }; // the entry exists but this caller cannot prove it created it: no id, no link
  return { id: r.id, replay: r.replay, ...(r.owner ? { manageUrl: `/waitlist/${signToken({ appointmentId: r.id, scope: "wl_view", ttlSeconds: ttl })}` } : {}) };
}

function mapJoinError(e: { code?: string | null; message?: string | null }) {
  const m = e.message ?? "";
  if (m.includes("waitlist_limit")) return fail("WAITLIST_LIMIT", "אפשר להיות ברשימת המתנה של עד שלושה ימים בו-זמנית. אפשר להסיר אחד מהם בקישור שקיבלתם.");
  if (m.includes("service_unavailable")) return fail("SERVICE_UNAVAILABLE", "השירות כבר אינו זמין. בחרו שירות אחר.");
  if (m.includes("date_out_of_range")) return fail("VALIDATION_FAILED", "הבקשה אינה תקינה.", [{ field: "date", message: "התאריך מחוץ לטווח ההזמנות של העסק." }]);
  if (m.includes("email_required")) return fail("VALIDATION_FAILED", "הבקשה אינה תקינה.", [{ field: "customer.email", message: "יש להזין כתובת אימייל — ההצעות נשלחות אליה." }]);
  if (m.includes("not_found") || m.includes("plan_required")) return fail("NOT_FOUND", "לא נמצא.");
  if (e.code === "23514") return fail("VALIDATION_FAILED", "הבקשה אינה תקינה.");
  console.error(JSON.stringify({ level: "error", msg: "waitlist join failed", code: e.code })); // no PII in logs
  return new Error("waitlist join failed");
}

// ---------------------------------------------------------------- the customer's page
export interface WaitlistView {
  entryId: string;
  status: "waiting" | "offered" | "booked" | "cancelled";
  onDate: string;
  fromMinute: number | null;
  toMinute: number | null;
  serviceName: string;
  businessName: string;
  businessSlug: string;
  timezone: string;
  offer: { id: string; slotStartsAt: string; slotEndsAt: string; expiresAt: string; personName?: string | null } | null;
  booking: { startsAt: string; reference: string; status: string } | null;
  /** Single-use action links, minted fresh on every view. */
  tokens: { accept: string | null; decline: string | null; leave: string | null };
}

/** Every failure is the same `null`: forged, expired and unknown links are indistinguishable. */
export async function viewWaitlist(token: string): Promise<WaitlistView | null> {
  const v = verifyToken(token, "wl_view");
  if (!v.ok) return null;
  const { data, error } = await systemDb().rpc("waitlist_view", { p_entry: v.payload.a });
  if (error || !data) return null;
  const d = data as Omit<WaitlistView, "entryId" | "tokens"> & { id: string };
  const active = d.status === "waiting" || d.status === "offered";
  const secondsLeft = d.offer ? Math.max(60, Math.floor((Date.parse(d.offer.expiresAt) - Date.now()) / 1000)) : 0;
  return {
    entryId: d.id, status: d.status, onDate: d.onDate, fromMinute: d.fromMinute, toMinute: d.toMinute, serviceName: d.serviceName, businessName: d.businessName,
    businessSlug: d.businessSlug, timezone: d.timezone, offer: d.offer, booking: d.booking,
    tokens: {
      accept: d.offer ? signToken({ appointmentId: d.offer.id, scope: "wl_accept", ttlSeconds: secondsLeft }) : null,
      decline: d.offer ? signToken({ appointmentId: d.offer.id, scope: "wl_decline", ttlSeconds: secondsLeft }) : null,
      leave: active ? signToken({ appointmentId: d.id, scope: "wl_leave", ttlSeconds: 3600 }) : null,
    },
  };
}

export type WaitlistActionOutcome = "accepted" | "slot_taken" | "expired" | "not_pending" | "declined" | "left" | "not_active" | "limit" | "invalid";

async function consumed(jti: string, exp: number) {
  const r = await systemDb().rpc("public_consume_token", { p_jti: jti, p_exp: new Date(exp * 1000).toISOString() }); // single use (SEC-06)
  return !r.error && r.data === true;
}

async function act(token: string, scope: "wl_accept" | "wl_decline" | "wl_leave", fn: "waitlist_accept" | "waitlist_decline" | "waitlist_leave", arg: "p_offer" | "p_entry"): Promise<WaitlistActionOutcome> {
  const v = verifyToken(token, scope);
  if (!v.ok || !(await consumed(v.payload.j, v.payload.e))) return "invalid";
  const { data, error } = await systemDb().rpc(fn, { [arg]: v.payload.a });
  if (error) return "invalid";
  const outcome = (data as { outcome?: string } | null)?.outcome;
  return (["accepted", "slot_taken", "expired", "not_pending", "declined", "left", "not_active", "limit"] as const).find((o) => o === outcome) ?? "invalid";
}

export const acceptOffer = (token: string) => act(token, "wl_accept", "waitlist_accept", "p_offer");
export const declineOffer = (token: string) => act(token, "wl_decline", "waitlist_decline", "p_offer");
export const leaveWaitlist = (token: string) => act(token, "wl_leave", "waitlist_leave", "p_entry");
