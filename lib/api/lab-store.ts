// In-memory, session-scoped store behind the lab API. It implements the same *behaviour* the database will
// provide (atomic slot claim, idempotency, state machine) so UI↔API tests exercise real contracts today.
// Fidelity note (docs/04 §8): this is NOT database evidence; DB-level concurrency is proven in stages 2–4.
import { fail } from "@/lib/api/http";
import type { z } from "zod";
import type { CreateBookingInput, AppointmentDto } from "@/lib/api/contracts";
import { LAB_TODAY, formatDayLabel } from "@/lib/lab/booking-data";
import { normalizePhone } from "@/lib/phone";
import { classifySlots, daySegments, type Interval, type TimeWindow } from "@/modules/availability/engine";
import { getKind, type BusinessKindId, type ServicePreset } from "@/modules/tenancy/business-kind";
import { buildBookingEmail, type EmailPreview } from "@/lib/api/notifications";

export const LAB_NOW = 11 * 60 + 10; // 11:10 on LAB_TODAY
const HORIZON_DAYS = 60;

type Appt = z.infer<typeof AppointmentDto>;
interface StoredBooking {
  id: string;
  reference: string;
  status: "confirmed" | "pending";
  serviceId: string;
  date: string;
  start: number;
  end: number;
  customerName: string;
  customerEmail: string;
  group: boolean;
}
interface State {
  bookings: StoredBooking[];
  appointments: Appt[];
  idem: Map<string, { hash: string; bookingId: string }>;
  rate: { count: number; resetAt: number };
  seq: number;
}

const sessions = new Map<string, State>();
const MAX_SESSIONS = 500; // lab only; keeps memory bounded

const EMPTY_WINDOWS: TimeWindow[] = [];
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
export const fmtTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function parseIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}
export function weekdayOf(iso: string): number {
  const { y, m, d } = parseIso(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function daysBetween(a: string, b: string) {
  const A = parseIso(a), B = parseIso(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86_400_000);
}
export function addDays(iso: string, n: number): string {
  const { y, m, d } = parseIso(iso);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 100;
}

const NAMES = ["אורי שמעוני", "מיכל אברהם", "דנה כהן", "נועם לוי", "שירה מזרחי", "יוסי ביטון", "רונית דאהר", "עמית פרידמן", "תמר גולן"];

function seedAppointments(kind: BusinessKindId): Appt[] {
  const k = getKind(kind);
  const windows = k.hours[weekdayOf(LAB_TODAY)];
  const solo = k.presets.filter((p) => !p.group);
  const out: Appt[] = [];
  let n = 0;
  for (const w of windows) {
    let cursor = w.from;
    while (n < 9) {
      const p = solo[n % solo.length];
      const end = cursor + p.durationMinutes;
      if (end > w.to) break;
      out.push({ id: `a${n + 1}`, date: LAB_TODAY, start: cursor, end, customer: NAMES[n % NAMES.length], service: p.name, status: "confirmed" });
      cursor = end + (n % 3 === 2 ? 60 : 0); // every third appointment leaves a free gap
      n++;
    }
  }
  const future = out.filter((a) => a.start > LAB_NOW);
  const pattern: Appt["status"][] = ["confirmed", "pending", "confirmed", "cancellationRequested", "pending", "confirmed"];
  future.forEach((a, i) => {
    a.status = pattern[i % pattern.length];
    if (a.status === "pending" && i === 1) a.note = "לקוח חדש";
    if (a.status === "cancellationRequested") a.note = "מבקש לבטל";
  });
  for (const a of out) if (a.end <= LAB_NOW) a.status = "completed";
  return out;
}

function stateOf(session: string, kind: BusinessKindId): State {
  const key = `${session}:${kind}`;
  let s = sessions.get(key);
  if (!s) {
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value as string);
    s = { bookings: [], appointments: seedAppointments(kind), idem: new Map(), rate: { count: 0, resetAt: 0 }, seq: 0 };
    sessions.set(key, s);
  }
  return s;
}

export const labReset = (session: string) => [...sessions.keys()].filter((k) => k.startsWith(`${session}:`)).forEach((k) => sessions.delete(k));

// ---------- catalog ----------
export function servicesOf(kind: BusinessKindId) {
  return getKind(kind).presets.map((p) => ({ id: p.id, name: p.name, description: p.description, durationMinutes: p.durationMinutes, priceNis: p.priceNis, group: !!p.group }));
}
export function findService(kind: BusinessKindId, id: string): ServicePreset | undefined {
  return getKind(kind).presets.find((p) => p.id === id);
}
export function businessOf(kind: BusinessKindId) {
  const k = getKind(kind);
  return {
    name: k.sample.businessName,
    address: k.sample.address,
    locations: k.locations,
    intake: k.intake.map((f) => ({ id: f.id, label: f.label, type: f.type, options: f.options, required: f.required })),
    vocab: { ...k.vocab } as Record<string, string>,
    requireApproval: k.defaults.requireApproval,
    cancelUntilHours: k.defaults.cancelUntilHours,
  };
}

// ---------- availability ----------
type Busy = Interval & { group?: { serviceId: string; count: number } };

function busyFor(kind: BusinessKindId, st: State, iso: string, windows: TimeWindow[]): Busy[] {
  const k = getKind(kind);
  const busy: Busy[] = [];
  const groupPreset = k.presets.find((p) => p.group);
  // Seeded "other customers": deterministic so UI and tests agree.
  const groupSeeds: Busy[] = [];
  if (groupPreset && k.group.supported) {
    for (const w of windows) {
      for (let s = w.from; s + groupPreset.durationMinutes <= w.to; s += groupPreset.durationMinutes) {
        // A minority of aligned times are *scheduled* group sessions (the owner opened them); some already have participants.
        if (hash(`${kind}|${iso}|g|${s}`) >= 40) continue;
        const count = hash(`${kind}|${iso}|c|${s}`) % k.group.defaultCapacity; // 0 … capacity-1: never full by seed
        groupSeeds.push({ start: s, end: s + groupPreset.durationMinutes, group: { serviceId: groupPreset.id, count } });
      }
    }
  }
  for (const w of windows) {
    for (let s = w.from; s < w.to; s += k.defaults.slotStepMinutes) {
      if (hash(`${kind}|${iso}|${s}`) < 28) {
        const iv = { start: s, end: Math.min(s + k.defaults.slotStepMinutes, w.to) };
        if (!groupSeeds.some((g) => g.start < iv.end && iv.start < g.end)) busy.push(iv);
      }
    }
  }
  busy.push(...groupSeeds);
  // Real bookings in this session.
  const groupCounts = new Map<string, Busy>();
  for (const b of st.bookings.filter((x) => x.date === iso)) {
    if (b.group) {
      const key = `${b.serviceId}:${b.start}`;
      const existing = groupCounts.get(key) ?? busy.find((x) => x.group?.serviceId === b.serviceId && x.start === b.start);
      if (existing) existing.group!.count += 1;
      else {
        const e: Busy = { start: b.start, end: b.end, group: { serviceId: b.serviceId, count: 1 } };
        groupCounts.set(key, e);
        busy.push(e);
      }
    } else {
      busy.push({ start: b.start, end: b.end + k.defaults.bufferMinutes });
    }
  }
  return busy;
}

function engineInput(kind: BusinessKindId, st: State, iso: string, svc: ServicePreset) {
  const k = getKind(kind);
  const windows = k.hours[weekdayOf(iso)] ?? EMPTY_WINDOWS;
  const busy = busyFor(kind, st, iso, windows);
  const capacity = k.group.defaultCapacity;
  return {
    windows,
    durationMinutes: svc.durationMinutes,
    step: svc.group ? svc.durationMinutes : k.defaults.slotStepMinutes,
    buffer: svc.group ? 0 : k.defaults.bufferMinutes,
    busy,
    nowMinutes: iso === LAB_TODAY ? LAB_NOW : iso < LAB_TODAY ? 24 * 60 : undefined,
    // A group session with seats left is still bookable for that group service.
    ignore: svc.group ? (iv: Interval, start: number) => { const g = (iv as Busy).group; return !!g && g.serviceId === svc.id && iv.start === start && g.count < capacity; } : undefined,
    capacity,
    // Group services are only bookable at sessions the owner scheduled.
    allow: svc.group ? (start: number) => busy.some((b) => (b as Busy).group?.serviceId === svc.id && b.start === start) : undefined,
  };
}

function groupSpotsLeft(input: ReturnType<typeof engineInput>, svc: ServicePreset, start: number): number | undefined {
  if (!svc.group) return undefined;
  const g = (input.busy as Busy[]).find((b) => b.group?.serviceId === svc.id && b.start === start)?.group;
  return input.capacity - (g?.count ?? 0);
}

export function slotsFor(session: string, kind: BusinessKindId, serviceId: string, iso: string, selected?: string) {
  const svc = findService(kind, serviceId);
  if (!svc) throw fail("VALIDATION_FAILED", "השירות לא נמצא.", [{ field: "service", message: "השירות לא נמצא." }]);
  const st = stateOf(session, kind);
  const input = engineInput(kind, st, iso, svc);
  const free = classifySlots(input).filter((s) => s.status === "free");
  return {
    date: iso,
    closed: input.windows.length === 0,
    windows: input.windows,
    slots: free.map((s) => ({ time: fmtTime(s.start), ...(svc.group ? { spotsLeft: groupSpotsLeft(input, svc, s.start) } : {}) })),
    segments: daySegments({ ...input, selectedStart: selected ? toMin(selected) : undefined }),
  };
}

export function availabilityFor(session: string, kind: BusinessKindId, serviceId: string, from: string, days: number) {
  const svc = findService(kind, serviceId);
  if (!svc) throw fail("VALIDATION_FAILED", "השירות לא נמצא.", [{ field: "service", message: "השירות לא נמצא." }]);
  const st = stateOf(session, kind);
  return {
    days: Array.from({ length: days }, (_, i) => {
      const date = addDays(from, i);
      const input = engineInput(kind, st, date, svc);
      const free = classifySlots(input).filter((s) => s.status === "free").length;
      return { date, closed: input.windows.length === 0, freeSlots: free };
    }),
  };
}

// ---------- bookings ----------
export function checkRate(session: string, kind: BusinessKindId, limit = 20) {
  const st = stateOf(session, kind);
  const now = Date.now();
  if (now > st.rate.resetAt) st.rate = { count: 0, resetAt: now + 60_000 };
  st.rate.count += 1;
  if (st.rate.count > limit) {
    const retry = Math.max(1, Math.ceil((st.rate.resetAt - now) / 1000));
    throw fail("RATE_LIMITED", "יותר מדי ניסיונות. נסו שוב בעוד רגע.", undefined, { "Retry-After": String(retry) });
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createBooking(session: string, kind: BusinessKindId, input: CreateBookingInput, idemKey: string) {
  const k = getKind(kind);
  const st = stateOf(session, kind);
  const bodyHash = JSON.stringify(input);

  const prior = st.idem.get(idemKey);
  if (prior) {
    if (prior.hash !== bodyHash) throw fail("IDEMPOTENCY_KEY_REUSED", "מפתח הבקשה כבר שימש לבקשה אחרת.");
    return { booking: toDto(st.bookings.find((b) => b.id === prior.bookingId)!, k.defaults.requireApproval), replay: true };
  }

  const errors: { field: string; message: string }[] = [];
  const svc = findService(kind, input.serviceId);
  if (!svc) errors.push({ field: "serviceId", message: "השירות לא נמצא." });
  const phone = normalizePhone(input.customer.phone);
  if (!phone) errors.push({ field: "customer.phone", message: "מספר הטלפון אינו תקין." });
  const email = input.customer.email.trim();
  if (!EMAIL.test(email)) errors.push({ field: "customer.email", message: "כתובת האימייל אינה תקינה." });
  if (!k.locations.includes(input.location)) errors.push({ field: "location", message: "אופן קבלת השירות אינו נתמך." });
  for (const key of Object.keys(input.intake)) {
    const f = k.intake.find((x) => x.id === key);
    if (!f) errors.push({ field: `intake.${key}`, message: "שדה לא מוכר." });
    else if (f.type === "select" && input.intake[key] !== "" && !f.options?.includes(input.intake[key])) errors.push({ field: `intake.${key}`, message: "ערך לא חוקי." });
    else if (input.intake[key].length > 200) errors.push({ field: `intake.${key}`, message: "הטקסט ארוך מדי." });
  }
  for (const f of k.intake.filter((x) => x.required)) if (!input.intake[f.id]?.trim()) errors.push({ field: `intake.${f.id}`, message: "שדה חובה." });
  if (errors.length || !svc) throw fail("VALIDATION_FAILED", "הבקשה אינה תקינה.", errors);

  const offset = daysBetween(LAB_TODAY, input.date);
  if (offset < 0 || offset > HORIZON_DAYS) throw fail("INVALID_SLOT", "התאריך מחוץ לטווח ההזמנה.");

  // ---- atomic section: no awaits between the check and the write (the database does this with a constraint) ----
  const engine = engineInput(kind, st, input.date, svc);
  const start = toMin(input.time);
  const slot = classifySlots(engine).find((s) => s.start === start);
  if (!slot || slot.status === "unavailable") throw fail("INVALID_SLOT", "השעה אינה זמינה להזמנה.");
  if (slot.status === "taken") throw fail("SLOT_TAKEN", "השעה נתפסה. בחרו שעה אחרת.");

  st.seq += 1;
  const booking: StoredBooking = {
    id: `b${st.seq}`,
    reference: `TR-${(1_679_616 + st.seq * 104_729).toString(36).toUpperCase()}`,
    status: k.defaults.requireApproval ? "pending" : "confirmed",
    serviceId: svc.id,
    date: input.date,
    start,
    end: start + svc.durationMinutes,
    customerName: input.customer.fullName.trim(),
    customerEmail: email,
    group: !!svc.group,
  };
  st.bookings.push(booking);
  st.appointments.push({ id: booking.id, date: booking.date, start: booking.start, end: booking.end, customer: booking.customerName, service: svc.name, status: booking.status });
  st.idem.set(idemKey, { hash: bodyHash, bookingId: booking.id });
  return { booking: toDto(booking, k.defaults.requireApproval), replay: false };
}

const toDto = (b: StoredBooking, requiresApproval: boolean) => ({
  id: b.id, reference: b.reference, status: b.status, serviceId: b.serviceId, date: b.date, time: fmtTime(b.start), endTime: fmtTime(b.end), requiresApproval,
});

export function notificationFor(session: string, kind: BusinessKindId, bookingId: string): EmailPreview {
  const st = stateOf(session, kind);
  const b = st.bookings.find((x) => x.id === bookingId);
  if (!b) throw fail("NOT_FOUND", "ההזמנה לא נמצאה.");
  const svc = findService(kind, b.serviceId)!;
  return buildBookingEmail({
    kind, businessName: getKind(kind).sample.businessName, serviceName: svc.name, customerName: b.customerName,
    customerEmail: b.customerEmail || "(ללא אימייל)", dateLabel: formatDayLabel(b.date), time: fmtTime(b.start), reference: b.reference, status: b.status,
  });
}

// ---------- owner ----------
export function appointmentsFor(session: string, kind: BusinessKindId) {
  const st = stateOf(session, kind);
  return {
    kind,
    date: LAB_TODAY,
    windows: getKind(kind).hours[weekdayOf(LAB_TODAY)],
    now: LAB_NOW,
    appointments: st.appointments.filter((a) => a.date === LAB_TODAY).sort((a, b) => a.start - b.start),
  };
}

const TRANSITIONS = {
  approve: ["pending", "confirmed"],
  reject: ["pending", "cancelled"],
  approveCancellation: ["cancellationRequested", "cancelled"],
  declineCancellation: ["cancellationRequested", "confirmed"],
} as const;

export function transitionAppointment(session: string, kind: BusinessKindId, id: string, action: keyof typeof TRANSITIONS) {
  const st = stateOf(session, kind);
  const a = st.appointments.find((x) => x.id === id);
  if (!a) throw fail("NOT_FOUND", "התור לא נמצא.");
  const [from, to] = TRANSITIONS[action];
  if (a.status !== from) throw fail("INVALID_TRANSITION", "אי אפשר לבצע את הפעולה במצב הנוכחי של התור.");
  a.status = to;
  const b = st.bookings.find((x) => x.id === id);
  if (b && (to === "confirmed" || to === "cancelled")) {
    if (to === "cancelled") st.bookings = st.bookings.filter((x) => x.id !== id); // frees the slot
    else b.status = "confirmed";
  }
  return { appointment: a };
}
