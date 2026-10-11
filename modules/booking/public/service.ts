import "server-only";
// Public booking service (system path). Hours come from the TS slot engine, conflicts from the database (EXCLUDE).
// Everything returned is customer-safe: free slots only, never other customers' data (BKG-13).
import { createHash } from "node:crypto";
import { z } from "zod";
import * as C from "@/lib/api/contracts";
import { fail } from "@/lib/api/http";
import { normalizePhone } from "@/lib/phone";
import { segmentsFromSlots } from "@/modules/availability/segments";
import { addDaysIso, availabilityForRange, slotsForDay, windowsForDate, type BusyInterval, type DayException, type WeeklyRule } from "@/modules/availability/slots";
import { signToken, verifyToken } from "@/modules/booking/token";
import { BUSINESS_KINDS, KIND_IDS, type BusinessKindId } from "@/modules/tenancy/business-kind";
import { systemDb } from "@/platform/system-db";
import { systemClock, zonedParts, zonedTimeToUtc } from "@/platform/clock";

export const Slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/i).max(40);

const CatalogRpc = z.object({
  business: z.object({
    id: z.uuid(), slug: z.string(), name: z.string(), kind: z.enum(KIND_IDS), timezone: z.string(), address: z.string(),
    requiresApproval: z.boolean(), cancelUntilHours: z.number(), minNoticeMinutes: z.number(), horizonDays: z.number(), waitlistEnabled: z.boolean(),
  }),
  services: z.array(z.object({ id: z.uuid(), name: z.string(), description: z.string(), durationMinutes: z.number(), bufferMinutes: z.number(), priceCents: z.number(), requiresApproval: z.boolean().nullable() })),
  rules: z.array(z.object({ weekday: z.number(), startMinute: z.number(), endMinute: z.number() })),
  exceptions: z.array(z.object({ date: z.string(), kind: z.enum(["closed", "open"]), startMinute: z.number().nullable(), endMinute: z.number().nullable() })),
});
export type Catalog = z.infer<typeof CatalogRpc>;
export type Resolved = { kind: "ok"; catalog: Catalog } | { kind: "redirect"; slug: string } | { kind: "not_found" };

export async function resolveCatalog(rawSlug: string): Promise<Resolved> {
  const slug = Slug.safeParse(rawSlug);
  if (!slug.success) return { kind: "not_found" };
  const { data, error } = await systemDb().rpc("public_catalog", { p_slug: slug.data });
  if (error) throw new Error("catalog unavailable");
  if (!data) return { kind: "not_found" }; // unknown and unpublished are indistinguishable (BKG-11)
  if (typeof (data as { redirect?: string }).redirect === "string") return { kind: "redirect", slug: (data as { redirect: string }).redirect };
  return { kind: "ok", catalog: CatalogRpc.parse(data) };
}

const kindOf = (c: Catalog): BusinessKindId => c.business.kind;
const rulesOf = (c: Catalog): WeeklyRule[] => c.rules;
const exceptionsOf = (c: Catalog): DayException[] => c.exceptions;

export function toServicesResponse(c: Catalog): z.infer<typeof C.ServicesResponse> {
  const k = BUSINESS_KINDS[kindOf(c)];
  return {
    kind: kindOf(c),
    business: {
      name: c.business.name,
      address: c.business.address,
      locations: k.locations,
      intake: k.intake.map((f) => ({ id: f.id, label: f.label, type: f.type, options: f.options, required: f.required })),
      vocab: { ...k.vocab } as Record<string, string>,
      requireApproval: c.business.requiresApproval,
      cancelUntilHours: c.business.cancelUntilHours,
      waitlistEnabled: c.business.waitlistEnabled,
    },
    services: c.services.map((s) => ({ id: s.id, name: s.name, description: s.description, durationMinutes: s.durationMinutes, priceNis: s.priceCents / 100, group: false })),
  };
}

const findService = (c: Catalog, id: string) => c.services.find((s) => s.id === id);
const notFoundService = () => fail("VALIDATION_FAILED", "השירות לא נמצא.", [{ field: "service", message: "השירות לא נמצא." }]);

async function busyBetween(c: Catalog, fromDate: string, days: number): Promise<BusyInterval[]> {
  const tz = c.business.timezone;
  const from = new Date(zonedTimeToUtc(fromDate, 0, tz).getTime() - 86_400_000);
  const to = new Date(zonedTimeToUtc(addDaysIso(fromDate, days), 0, tz).getTime() + 86_400_000);
  const { data, error } = await systemDb().rpc("public_busy", { p_business: c.business.id, p_from: from.toISOString(), p_to: to.toISOString() });
  if (error) throw new Error("busy unavailable");
  return ((data ?? []) as { starts_at: string; blocked_until: string }[]).map((r) => ({ start: new Date(r.starts_at), end: new Date(r.blocked_until) }));
}

const today = (c: Catalog) => zonedParts(systemClock.now(), c.business.timezone).date;
const withinHorizon = (c: Catalog, date: string) => date >= today(c) && date <= addDaysIso(today(c), c.business.horizonDays);

function engine(c: Catalog, svcId: string, busy: BusyInterval[]) {
  const s = findService(c, svcId);
  if (!s) throw notFoundService();
  return { s, base: { timeZone: c.business.timezone, rules: rulesOf(c), exceptions: exceptionsOf(c), durationMinutes: s.durationMinutes, bufferMinutes: s.bufferMinutes, stepMinutes: 30, busy, now: systemClock.now(), minNoticeMinutes: c.business.minNoticeMinutes } };
}

export async function computeSlots(c: Catalog, svcId: string, date: string, selected?: string): Promise<z.infer<typeof C.SlotsResponse>> {
  const { s, base } = engine(c, svcId, await busyBetween(c, date, 1));
  const windows = windowsForDate(date, rulesOf(c), exceptionsOf(c));
  const slots = withinHorizon(c, date) ? slotsForDay({ ...base, date }) : [];
  return {
    date,
    closed: windows.length === 0,
    windows: windows.map((w) => ({ from: w.from, to: w.to })),
    slots: slots.map((x) => ({ time: x.local })),
    segments: segmentsFromSlots(windows, slots, s.durationMinutes, { selected }),
  };
}

export async function computeAvailability(c: Catalog, svcId: string, from: string, days: number): Promise<z.infer<typeof C.AvailabilityResponse>> {
  const { base } = engine(c, svcId, await busyBetween(c, from, days));
  const r = availabilityForRange({ ...base, from, days }).map((d) => ({ date: d.date, closed: d.closed, freeSlots: withinHorizon(c, d.date) ? d.freeSlots : 0 }));
  return { days: r };
}

// ---------------------------------------------------------------- booking
function validateIntake(kind: BusinessKindId, input: C.CreateBookingInput) {
  const k = BUSINESS_KINDS[kind];
  const errors: { field: string; message: string }[] = [];
  if (!k.locations.includes(input.location)) errors.push({ field: "location", message: "אופן קבלת השירות אינו נתמך." });
  for (const key of Object.keys(input.intake)) {
    const f = k.intake.find((x) => x.id === key);
    if (!f) errors.push({ field: `intake.${key}`, message: "שדה לא מוכר." });
    else if (f.type === "select" && input.intake[key] !== "" && !f.options?.includes(input.intake[key])) errors.push({ field: `intake.${key}`, message: "ערך לא חוקי." });
    else if (input.intake[key].length > 200) errors.push({ field: `intake.${key}`, message: "הטקסט ארוך מדי." });
  }
  for (const f of k.intake.filter((x) => x.required)) if (!input.intake[f.id]?.trim()) errors.push({ field: `intake.${f.id}`, message: "שדה חובה." });
  return errors;
}

const hashOf = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");

export async function createBooking(c: Catalog, input: C.CreateBookingInput, idemKey: string): Promise<{ booking: z.infer<typeof C.BookingDto>; replay: boolean }> {
  const errors = validateIntake(kindOf(c), input);
  const phone = normalizePhone(input.customer.phone);
  if (!phone) errors.push({ field: "customer.phone", message: "מספר הטלפון אינו תקין." });
  if (errors.length) throw fail("VALIDATION_FAILED", "הבקשה אינה תקינה.", errors);
  const svc = findService(c, input.serviceId);
  if (!svc) throw fail("SERVICE_UNAVAILABLE", "השירות כבר אינו זמין. בחרו שירות אחר.");

  // Hours (TS): the requested start must be a slot the engine could ever offer on that date (ignoring who is busy).
  const structural = slotsForDay({ date: input.date, timeZone: c.business.timezone, rules: rulesOf(c), exceptions: exceptionsOf(c), durationMinutes: svc.durationMinutes, bufferMinutes: svc.bufferMinutes, stepMinutes: 30, now: new Date(0), minNoticeMinutes: 0 });
  const wanted = structural.find((s) => s.local === input.time);
  if (!wanted || !withinHorizon(c, input.date)) throw fail("INVALID_SLOT", "השעה אינה זמינה להזמנה.");

  const { data, error } = await systemDb().rpc("public_book", {
    p_business: c.business.id,
    p_service: svc.id,
    p_starts_at: wanted.startUtc,
    p_full_name: input.customer.fullName.trim(),
    p_phone: phone,
    p_email: input.customer.email?.trim() || null,
    p_location: input.location,
    p_intake: input.intake,
    p_idem_key: idemKey,
    p_request_hash: hashOf({ s: svc.id, d: input.date, t: input.time, l: input.location, c: [input.customer.fullName.trim(), phone, input.customer.email?.trim() ?? ""], i: input.intake }),
  });
  if (error) throw mapBookingError(error);
  const r = data as { replay: boolean; id: string; reference: string; status: "confirmed" | "pending"; startsAt: string; endsAt: string };
  const start = new Date(r.startsAt);
  const manage = signToken({ appointmentId: r.id, scope: "view", ttlSeconds: Math.max(3600, Math.floor((start.getTime() - Date.now()) / 1000) + 7 * 86_400) });
  const end = zonedParts(new Date(r.endsAt), c.business.timezone).minutes;
  return {
    replay: r.replay,
    booking: {
      id: r.id,
      reference: r.reference,
      status: r.status,
      serviceId: svc.id,
      date: input.date,
      time: input.time,
      endTime: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`,
      requiresApproval: r.status === "pending",
      manageUrl: `/booking/${manage}`,
    },
  };
}

function mapBookingError(e: { code?: string | null; message?: string | null }) {
  const m = e.message ?? "";
  if (m.includes("slot_taken")) return fail("SLOT_TAKEN", "השעה נתפסה. בחרו שעה אחרת.");
  if (m.includes("idempotency_reuse")) return fail("IDEMPOTENCY_KEY_REUSED", "מפתח הבקשה כבר שימש לבקשה אחרת.");
  if (m.includes("slot_in_past") || m.includes("slot_too_far")) return fail("INVALID_SLOT", "השעה אינה זמינה להזמנה.");
  if (m.includes("service_unavailable")) return fail("SERVICE_UNAVAILABLE", "השירות כבר אינו זמין. בחרו שירות אחר.");
  if (m.includes("booking_limit")) return fail("BOOKING_LIMIT", "יש כבר כמה תורים עתידיים על המספר הזה. אפשר לנהל אותם בקישור שנשלח.");
  if (m.includes("not_found")) return fail("NOT_FOUND", "לא נמצא.");
  if (e.code === "23514") return fail("VALIDATION_FAILED", "הבקשה אינה תקינה.");
  console.error(JSON.stringify({ level: "error", msg: "booking rpc failed", code: e.code })); // no PII in logs (BKG-14)
  return new Error("booking failed");
}

// ---------------------------------------------------------------- customer link: view + cancel
export interface AppointmentView {
  id: string;
  reference: string;
  status: string;
  startsAt: string;
  endsAt: string;
  serviceName: string;
  priceCents: number;
  businessName: string;
  businessSlug: string;
  timezone: string;
  cancelUntil: string;
  canCancel: boolean;
  cancelToken: string | null;
}

export async function viewAppointment(token: string): Promise<AppointmentView | null> {
  const v = verifyToken(token, "view");
  if (!v.ok) return null;
  const { data, error } = await systemDb().rpc("public_get_appointment", { p_id: v.payload.a });
  if (error || !data) return null;
  const a = data as Omit<AppointmentView, "canCancel" | "cancelToken">;
  const canCancel = (a.status === "pending" || a.status === "confirmed") && Date.now() < Date.parse(a.cancelUntil);
  return { ...a, canCancel, cancelToken: canCancel ? signToken({ appointmentId: a.id, scope: "cancel", ttlSeconds: 3600 }) : null };
}

export type CancelOutcome = "cancelled" | "too_late" | "already" | "invalid";

export async function cancelWithToken(cancelToken: string): Promise<CancelOutcome> {
  const v = verifyToken(cancelToken, "cancel");
  if (!v.ok) return "invalid";
  const db = systemDb();
  const first = await db.rpc("public_consume_token", { p_jti: v.payload.j, p_exp: new Date(v.payload.e * 1000).toISOString() }); // single use (SEC-06)
  if (first.error || first.data !== true) return "invalid";
  const { error } = await db.rpc("public_cancel", { p_id: v.payload.a });
  if (!error) return "cancelled";
  if ((error.message ?? "").includes("too_late")) return "too_late";
  if ((error.message ?? "").includes("invalid_transition")) return "already";
  return "invalid";
}
