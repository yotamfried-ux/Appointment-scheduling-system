import "server-only";
// Public booking service (system path). Hours come from the TS slot engine, conflicts from the database (EXCLUDE).
// Everything returned is customer-safe: free slots only, never other customers' data (BKG-13).
import { createHash } from "node:crypto";

const hashKey = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32); // same key shape as the rate limiter (no address is stored, BKG-14)
import { z } from "zod";
import * as C from "@/lib/api/contracts";
import { fail } from "@/lib/api/http";
import { normalizePhone } from "@/lib/phone";
import { segmentsFromSlots } from "@/modules/availability/segments";
import { addDaysIso } from "@/modules/availability/slots";
import { eligiblePeople, orderCandidates, peopleOpenAt, teamAvailabilityForRange, teamSlotsForDay, teamWindowsForDate, type TeamBusy, type TeamException, type TeamPerson, type TeamRule } from "@/modules/availability/team";
import { signToken, verifyToken } from "@/modules/booking/token";
import { BUSINESS_KINDS, KIND_IDS, type BusinessKindId } from "@/modules/tenancy/business-kind";
import { systemDb } from "@/platform/system-db";
import { systemClock, zonedParts, zonedTimeToUtc } from "@/platform/clock";

export const Slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/i).max(40);

const CatalogRpc = z.object({
  business: z.object({
    id: z.uuid(), slug: z.string(), name: z.string(), kind: z.enum(KIND_IDS), timezone: z.string(), address: z.string(),
    requiresApproval: z.boolean(), cancelUntilHours: z.number(), minNoticeMinutes: z.number(), horizonDays: z.number(), waitlistEnabled: z.boolean(), acceptingBookings: z.boolean(),
  }),
  services: z.array(z.object({ id: z.uuid(), name: z.string(), description: z.string(), durationMinutes: z.number(), bufferMinutes: z.number(), priceCents: z.number(), priceMode: z.enum(["fixed", "from", "free", "hidden"]).default("fixed"), requiresApproval: z.boolean().nullable(), staffIds: z.array(z.uuid()).nullable().default(null) })),
  team: z.array(z.object({ id: z.uuid(), name: z.string() })).min(1),
  rules: z.array(z.object({ resourceId: z.uuid(), weekday: z.number(), startMinute: z.number(), endMinute: z.number() })),
  exceptions: z.array(z.object({ resourceId: z.uuid().nullable(), date: z.string(), kind: z.enum(["closed", "open"]), startMinute: z.number().nullable(), endMinute: z.number().nullable() })),
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

/**
 * One database call for everything a public availability/slots request needs (rate-limit counter + catalog + busy times); see migration public_range.
 * A refused request throws RATE_LIMITED, an unknown or unpublished business throws NOT_FOUND; an old slug is followed with the ordinary path.
 */
export async function loadPublicRange(rawSlug: string, from: string, days: number, limit: { value: string; windowSeconds: number; max: number }): Promise<{ catalog: Catalog; busy: TeamBusy[] }> {
  const slug = Slug.safeParse(rawSlug);
  if (!slug.success) throw fail("NOT_FOUND", "העסק לא נמצא או אינו מקבל תורים כרגע.");
  const { data, error } = await systemDb().rpc("public_range", { p_slug: slug.data, p_from: from, p_days: days, p_key: `read:${hashKey(limit.value)}`, p_window_seconds: limit.windowSeconds, p_max: limit.max });
  if (error) throw new Error("availability unavailable");
  const d = data as { rate: { allowed: boolean; retry_after: number }; catalog?: unknown; busy?: { starts_at: string; blocked_until: string; resource_id: string }[] };
  if (!d.rate.allowed) throw fail("RATE_LIMITED", "יותר מדי ניסיונות. נסו שוב בעוד רגע.", undefined, { "Retry-After": String(d.rate.retry_after) });
  const cat = d.catalog as { redirect?: string } | null | undefined;
  if (!cat) throw fail("NOT_FOUND", "העסק לא נמצא או אינו מקבל תורים כרגע.");
  if (typeof cat.redirect === "string") {
    const c = await catalogOr404Via(cat.redirect);
    return { catalog: c, busy: await busyBetween(c, from, days) };
  }
  return { catalog: CatalogRpc.parse(cat), busy: (d.busy ?? []).map((r) => ({ start: new Date(r.starts_at), end: new Date(r.blocked_until), resourceId: r.resource_id })) };
}

async function catalogOr404Via(slug: string): Promise<Catalog> {
  const r = await resolveCatalog(slug);
  if (r.kind !== "ok") throw fail("NOT_FOUND", "העסק לא נמצא או אינו מקבל תורים כרגע.");
  return r.catalog;
}

const kindOf = (c: Catalog): BusinessKindId => c.business.kind;
const rulesOf = (c: Catalog): TeamRule[] => c.rules;
const exceptionsOf = (c: Catalog): TeamException[] => c.exceptions;
/** Who may do this service, optionally narrowed to the person the customer named (T2/T3). */
const peopleFor = (c: Catalog, svcId: string, personId?: string | null): TeamPerson[] => eligiblePeople(c.team, findService(c, svcId)?.staffIds ?? null, personId);

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
      acceptingBookings: c.business.acceptingBookings,
    },
    services: c.services.map((s) => ({ id: s.id, name: s.name, description: s.description, durationMinutes: s.durationMinutes, priceNis: s.priceCents / 100, priceMode: s.priceMode, group: false, personIds: s.staffIds })),
    team: c.team.length > 1 ? c.team : [],
  };
}

const findService = (c: Catalog, id: string) => c.services.find((s) => s.id === id);
const notFoundService = () => fail("VALIDATION_FAILED", "השירות לא נמצא.", [{ field: "service", message: "השירות לא נמצא." }]);

async function busyBetween(c: Catalog, fromDate: string, days: number): Promise<TeamBusy[]> {
  const tz = c.business.timezone;
  const from = new Date(zonedTimeToUtc(fromDate, 0, tz).getTime() - 86_400_000);
  const to = new Date(zonedTimeToUtc(addDaysIso(fromDate, days), 0, tz).getTime() + 86_400_000);
  const { data, error } = await systemDb().rpc("public_busy", { p_business: c.business.id, p_from: from.toISOString(), p_to: to.toISOString() });
  if (error) throw new Error("busy unavailable");
  return ((data ?? []) as { starts_at: string; blocked_until: string; resource_id: string }[]).map((r) => ({ start: new Date(r.starts_at), end: new Date(r.blocked_until), resourceId: r.resource_id }));
}

const today = (c: Catalog) => zonedParts(systemClock.now(), c.business.timezone).date;
const withinHorizon = (c: Catalog, date: string) => date >= today(c) && date <= addDaysIso(today(c), c.business.horizonDays);

function engine(c: Catalog, svcId: string, busy: TeamBusy[], personId?: string | null) {
  const s = findService(c, svcId);
  if (!s) throw notFoundService();
  return { s, base: { people: peopleFor(c, svcId, personId), timeZone: c.business.timezone, rules: rulesOf(c), exceptions: exceptionsOf(c), durationMinutes: s.durationMinutes, bufferMinutes: s.bufferMinutes, stepMinutes: 30, busy, now: systemClock.now(), minNoticeMinutes: c.business.minNoticeMinutes } };
}

export async function computeSlots(c: Catalog, svcId: string, date: string, selected?: string, personId?: string, busyIn?: TeamBusy[]): Promise<z.infer<typeof C.SlotsResponse>> {
  if (!c.business.acceptingBookings) throw fail("BOOKINGS_CLOSED", "העסק אינו מקבל כרגע תורים חדשים.");
  const { s, base } = engine(c, svcId, busyIn ?? (await busyBetween(c, date, 1)), personId);
  const windows = teamWindowsForDate(date, base.people, rulesOf(c), exceptionsOf(c));
  const slots = withinHorizon(c, date) ? teamSlotsForDay({ ...base, date }) : [];
  return {
    date,
    closed: windows.length === 0,
    windows: windows.map((w) => ({ from: w.from, to: w.to })),
    slots: slots.map((x) => ({ time: x.local })),
    segments: segmentsFromSlots(windows, slots, s.durationMinutes, { selected }),
  };
}

export async function computeAvailability(c: Catalog, svcId: string, from: string, days: number, personId?: string, busyIn?: TeamBusy[]): Promise<z.infer<typeof C.AvailabilityResponse>> {
  if (!c.business.acceptingBookings) throw fail("BOOKINGS_CLOSED", "העסק אינו מקבל כרגע תורים חדשים.");
  const { base } = engine(c, svcId, busyIn ?? (await busyBetween(c, from, days)), personId);
  const r = teamAvailabilityForRange({ ...base, from, days }).map((d) => ({ date: d.date, closed: d.closed, freeSlots: withinHorizon(c, d.date) ? d.freeSlots : 0 }));
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
  if (!c.business.acceptingBookings) throw fail("BOOKINGS_CLOSED", "העסק אינו מקבל כרגע תורים חדשים.");
  const errors = validateIntake(kindOf(c), input);
  const phone = normalizePhone(input.customer.phone);
  if (!phone) errors.push({ field: "customer.phone", message: "מספר הטלפון אינו תקין." });
  if (errors.length) throw fail("VALIDATION_FAILED", "הבקשה אינה תקינה.", errors);
  const svc = findService(c, input.serviceId);
  if (!svc) throw fail("SERVICE_UNAVAILABLE", "השירות כבר אינו זמין. בחרו שירות אחר.");

  // Hours (TS): the requested start must be a time at least one eligible person works (ignoring who is busy). The people open then are the candidates,
  // ordered "fewest appointments that day, then position" (T5); a named person is the only candidate and is remembered as chosen (T6). The database tries them in order.
  const people = peopleFor(c, svc.id, input.personId ?? null);
  if (input.personId && people.length === 0) throw fail("INVALID_SLOT", "השעה אינה זמינה להזמנה.");
  const open = peopleOpenAt({ date: input.date, time: input.time, timeZone: c.business.timezone, durationMinutes: svc.durationMinutes, bufferMinutes: svc.bufferMinutes, stepMinutes: 30, people, rules: rulesOf(c), exceptions: exceptionsOf(c) });
  const wanted = teamSlotsForDay({ date: input.date, timeZone: c.business.timezone, people: open, rules: rulesOf(c), exceptions: exceptionsOf(c), busy: [], durationMinutes: svc.durationMinutes, bufferMinutes: svc.bufferMinutes, stepMinutes: 30, now: new Date(0), minNoticeMinutes: 0 }).find((s) => s.local === input.time);
  if (!wanted || !withinHorizon(c, input.date)) throw fail("INVALID_SLOT", "השעה אינה זמינה להזמנה.");
  const dayCounts = new Map<string, number>();
  for (const b of await busyBetween(c, input.date, 1)) if (zonedParts(b.start, c.business.timezone).date === input.date) dayCounts.set(b.resourceId, (dayCounts.get(b.resourceId) ?? 0) + 1);
  const candidates = orderCandidates(c.team, wanted.freeIds, (id) => dayCounts.get(id) ?? 0);

  const { data, error } = await systemDb().rpc("public_book_team", {
    p_business: c.business.id,
    p_service: svc.id,
    p_starts_at: wanted.startUtc,
    p_full_name: input.customer.fullName.trim(),
    p_phone: phone,
    p_email: input.customer.email.trim(),
    p_location: input.location,
    p_intake: input.intake,
    p_idem_key: idemKey,
    p_request_hash: hashOf({ s: svc.id, d: input.date, t: input.time, l: input.location, c: [input.customer.fullName.trim(), phone, input.customer.email.trim()], i: input.intake, p: input.personId ?? null }),
    p_resources: candidates,
    p_chosen: Boolean(input.personId),
    p_terms_version: input.acceptedTerms.terms,
    p_privacy_version: input.acceptedTerms.privacy,
  });
  if (error) throw mapBookingError(error);
  const r = data as { replay: boolean; id: string; reference: string; status: "confirmed" | "pending"; startsAt: string; endsAt: string; resourceId?: string };
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
      personName: c.team.length > 1 ? c.team.find((p) => p.id === r.resourceId)?.name : undefined,
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
  if (m.includes("customer_blocked")) return fail("BLOCKED", (e as { details?: string | null }).details?.trim() || "לא ניתן לקבוע תור אונליין כרגע. נשמח שתיצרו קשר עם העסק."); // BKG-08: the business' own words, nothing about counts
  if (m.includes("booking_limit")) return fail("BOOKING_LIMIT", "יש כבר כמה תורים עתידיים על המספר הזה. אפשר לנהל אותם בקישור שנשלח.");
  if (m.includes("billing_inactive")) return fail("BOOKINGS_CLOSED", "העסק אינו מקבל כרגע תורים חדשים.");
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
  priceMode: "fixed" | "from" | "free" | "hidden" | null;
  businessName: string;
  businessSlug: string;
  timezone: string;
  cancelUntil: string;
  updatedAt: string;
  serviceId: string;
  rescheduledCount: number;
  canCancel: boolean;
  canReschedule: boolean;
  attendanceConfirmedAt: string | null;
  /** NSH-01: the "I am coming" button is offered. */
  canAttend: boolean;
  serviceChangeAllowed: boolean;
  movedByBusinessAt: string | null;
  /** Stage 16: shown only when the business has two or more people. */
  personName?: string | null;
  teamSize?: number;
}

/**
 * The customer's link is the only proof needed to see and manage ONE appointment. The page no longer carries cancel / reschedule / attend tokens (Strix VULN-0022):
 * each action is a POST (Server Action, Origin-checked) that presents the link's own token, so nothing the page renders can be used elsewhere.
 */
export async function viewAppointment(token: string): Promise<AppointmentView | null> {
  const v = verifyToken(token, "view");
  if (!v.ok) return null;
  const { data, error } = await systemDb().rpc("public_get_appointment", { p_id: v.payload.a });
  if (error || !data) return null;
  const a = data as Omit<AppointmentView, "canCancel" | "canReschedule" | "canAttend">;
  const canCancel = (a.status === "pending" || a.status === "confirmed") && Date.now() < Date.parse(a.cancelUntil);
  const canReschedule = canCancel && a.rescheduledCount < 3; // RSC-02: same window as cancelling
  const canAttend = (a.status === "pending" || a.status === "confirmed") && !a.attendanceConfirmedAt && Date.parse(a.endsAt) > Date.now(); // NSH-01
  return { ...a, canCancel, canReschedule, canAttend };
}

export type CancelOutcome = "cancelled" | "too_late" | "already" | "invalid";

export async function cancelWithToken(viewToken: string): Promise<CancelOutcome> {
  const v = verifyToken(viewToken, "view");
  if (!v.ok) return "invalid";
  const { error } = await systemDb().rpc("public_cancel", { p_id: v.payload.a }); // the database makes a repeat harmless: a second cancel answers invalid_transition
  if (!error) return "cancelled";
  if ((error.message ?? "").includes("too_late")) return "too_late";
  if ((error.message ?? "").includes("invalid_transition")) return "already";
  return "invalid";
}

// ---------------------------------------------------------------- RSC-01/02: move to another slot of the same service
export type RescheduleOutcome = "moved" | "slot_taken" | "too_late" | "limit" | "invalid_slot" | "unavailable" | "service_change_not_allowed" | "invalid";

/** Presents the link's own token; the move limit (RSC-02) and the cancellation window are decided by the database. */
export async function rescheduleWithToken(viewToken: string, date: string, time: string, newServiceId?: string): Promise<RescheduleOutcome> {
  const v = verifyToken(viewToken, "view");
  if (!v.ok || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return "invalid";
  const db = systemDb();
  const { data: view } = await db.rpc("public_get_appointment", { p_id: v.payload.a });
  if (!view) return "invalid";
  const a = view as { serviceId: string; businessSlug: string; resourceId: string; resourceChosen: boolean };
  const res = await resolveCatalog(a.businessSlug);
  if (res.kind !== "ok") return "invalid";
  const c = res.catalog;
  const changing = Boolean(newServiceId && newServiceId !== a.serviceId); // RSC-03: the database decides whether the business allows it
  const svc = findService(c, changing ? newServiceId! : a.serviceId);
  if (!svc) return "unavailable";
  // T6: a customer who named the person keeps that person; otherwise anyone who can do the service and works then
  const people = peopleFor(c, svc.id, a.resourceChosen ? a.resourceId : null);
  const open = peopleOpenAt({ date, time, timeZone: c.business.timezone, durationMinutes: svc.durationMinutes, bufferMinutes: svc.bufferMinutes, stepMinutes: 30, people, rules: rulesOf(c), exceptions: exceptionsOf(c) });
  const wanted = teamSlotsForDay({ date, timeZone: c.business.timezone, people: open, rules: rulesOf(c), exceptions: exceptionsOf(c), busy: [], durationMinutes: svc.durationMinutes, bufferMinutes: svc.bufferMinutes, stepMinutes: 30, now: new Date(0), minNoticeMinutes: 0 }).find((s) => s.local === time);
  if (!wanted || !withinHorizon(c, date)) return "invalid_slot";
  const { error } = await db.rpc("public_reschedule", { p_id: v.payload.a, p_new_start: wanted.startUtc, p_new_service: changing ? newServiceId : null });
  if (!error) return "moved";
  const m = error.message ?? "";
  if (m.includes("slot_taken")) return "slot_taken";
  if (m.includes("too_late")) return "too_late";
  if (m.includes("reschedule_limit")) return "limit";
  if (m.includes("slot_in_past") || m.includes("slot_too_far") || m.includes("same_slot")) return "invalid_slot";
  if (m.includes("service_unavailable")) return "unavailable";
  if (m.includes("service_change_not_allowed")) return "service_change_not_allowed";
  return "invalid";
}

// ---------------------------------------------------------------- NSH-01: "I am coming"
export type AttendOutcome = "confirmed" | "already" | "not_active" | "invalid";

export async function confirmAttendanceWithToken(viewToken: string): Promise<AttendOutcome> {
  const v = verifyToken(viewToken, "view");
  if (!v.ok) return "invalid";
  const { data, error } = await systemDb().rpc("public_confirm_attendance", { p_id: v.payload.a }); // idempotent in the database: no single-use bookkeeping needed
  if (error) return "invalid";
  const o = (data as { outcome?: string } | null)?.outcome;
  return o === "confirmed" || o === "already" || o === "not_active" ? o : "invalid";
}
