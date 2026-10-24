import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type * as C from "@/lib/api/contracts";
import { fail } from "@/lib/api/http";
import { checkSession } from "@/lib/auth/live-session";
import { legalAccepted } from "@/lib/legal/gate";
import { myBilling, requireFeature } from "@/modules/billing/entitlements";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { addDaysIso } from "@/modules/availability/slots";
import { insideHours, teamWindowsForDate } from "@/modules/availability/team";
import { loadTeamCalendar } from "@/modules/team/repo";
import type { BusinessKindId } from "@/modules/tenancy/business-kind";
import { systemClock, zonedParts, zonedTimeToUtc } from "@/platform/clock";

// Owner operations run as the signed-in user: Row Level Security decides what is visible, the RPCs decide what may change.
// The business is derived from the session (first membership), never from anything the request says.
export interface OwnerCtx {
  supabase: SupabaseClient;
  business: { id: string; name: string; kind: BusinessKindId; timezone: string; waitlist_enabled: boolean; waitlist_auto_offer: boolean };
  /** The caller's role in that business (staff < admin < owner); decided by the database, read here only to shape the UI and refuse early. */
  role: string;
}

export async function ownerContext(): Promise<OwnerCtx> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const gate = claims ? await checkSession(supabase, claims) : null;
  if (!claims || !gate?.live) throw fail("UNAUTHENTICATED", "יש להתחבר מחדש.");
  if (!gate.secondFactor) throw fail("UNAUTHENTICATED", "נדרש אימות דו-שלבי.");
  // One round trip: my membership with its business embedded (a business is only visible to its members, so this is the same business as "the first one I can see").
  // Anything unexpected falls back to the two separate reads.
  const [accepted, joined] = await Promise.all([
    legalAccepted(supabase), // CMP-03 on the API too: new terms must be accepted before any owner request is served (VULN-0007); read in parallel with the membership
    supabase.from("business_members").select("role, businesses!inner(id, name, kind, timezone, waitlist_enabled, waitlist_auto_offer, created_at)").eq("user_id", String(claims.sub)).order("businesses(created_at)").limit(1),
  ]);
  if (!accepted) throw fail("FORBIDDEN", "יש לאשר את התנאים ומדיניות הפרטיות המעודכנים לפני המשך השימוש.");
  const row = joined.data?.[0] as { role?: string; businesses?: OwnerCtx["business"] | OwnerCtx["business"][] } | undefined;
  const embedded = Array.isArray(row?.businesses) ? row?.businesses[0] : row?.businesses;
  if (!joined.error && embedded && row?.role) {
    const { id, name, kind, timezone, waitlist_enabled, waitlist_auto_offer } = embedded; // created_at is only there so the rows can be ordered by it
    return { supabase, business: { id, name, kind, timezone, waitlist_enabled, waitlist_auto_offer }, role: row.role };
  }
  if (joined.error) console.error(JSON.stringify({ level: "warn", msg: "owner context: joined read failed, using the two-step read", code: joined.error.code })); // a silent fallback once hid a broken query (it cost an extra round trip on every owner request)
  const { data: rows } = await supabase.from("businesses").select("id, name, kind, timezone, waitlist_enabled, waitlist_auto_offer").order("created_at").limit(1);
  const b = rows?.[0] as OwnerCtx["business"] | undefined;
  if (!b) throw fail("FORBIDDEN", "אין עסק מקושר לחשבון.");
  const { data: m } = await supabase.from("business_members").select("role").eq("business_id", b.id).eq("user_id", String(claims.sub)).maybeSingle();
  return { supabase, business: b, role: (m?.role as string | undefined) ?? "staff" };
}

const hhmmToMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const statusOf = (s: string): z.infer<typeof C.OwnerStatus> =>
  s === "cancellation_requested" ? "cancellationRequested" : s === "no_show" ? "noShow" : s.startsWith("cancelled") ? "cancelled" : (s as "confirmed" | "pending" | "completed");

const COLUMNS = "id, status, starts_at, ends_at, source, out_of_availability, owner_note, resource_id, service_snapshot, customers(full_name, phone)";

interface WaitlistRow {
  id: string;
  on_date: string;
  from_minute: number | null;
  to_minute: number | null;
  status: "waiting" | "offered";
  customers: { full_name: string; phone: string } | null;
  services: { name: string } | null;
  waitlist_offers: { status: string; expires_at: string; slot_starts_at: string }[];
}

interface Row {
  id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  source: string;
  out_of_availability: boolean;
  owner_note: string | null;
  resource_id: string;
  service_snapshot: { name: string };
  customers: { full_name: string; phone: string } | null;
}

interface FailureRow {
  id: string;
  type: string;
  failure_code: C.FailureCode;
  appointments: { starts_at: string; customers: { full_name: string } | null } | null;
  waitlist_offers: { slot_starts_at: string; waitlist_entries: { customers: { full_name: string } | null } | null } | null;
}

export async function agenda(ctx: OwnerCtx, date: string, personId?: string): Promise<z.infer<typeof C.OwnerAgendaResponse>> {
  const tz = ctx.business.timezone;
  const from = zonedTimeToUtc(date, 0, tz);
  const to = zonedTimeToUtc(addDaysIso(date, 1), 0, tz);
  const dayQuery = ctx.supabase.from("appointments").select(COLUMNS).eq("business_id", ctx.business.id).gte("starts_at", from.toISOString()).lt("starts_at", to.toISOString());
  const [appts, cal, svcs, inbox, dead, wl, version, billing] = await Promise.all([
    (personId ? dayQuery.eq("resource_id", personId) : dayQuery).order("starts_at").limit(300),
    loadTeamCalendar(ctx.supabase, ctx.business.id),
    ctx.supabase.from("services").select("id, name, duration_minutes").eq("business_id", ctx.business.id).eq("active", true).eq("capacity", 1).order("position"),
    ctx.supabase
      .from("appointments")
      .select(COLUMNS)
      .eq("business_id", ctx.business.id)
      .in("status", ["pending", "cancellation_requested"])
      .gte("starts_at", new Date(systemClock.now().getTime() - 86_400_000).toISOString())
      .order("starts_at")
      .limit(50),
    ctx.supabase
      .from("notification_log")
      .select("id, type, failure_code, appointments(starts_at, customers(full_name)), waitlist_offers(slot_starts_at, waitlist_entries(customers(full_name)))")
      .eq("business_id", ctx.business.id)
      .eq("recipient", "customer")
      .not("failure_code", "is", null)
      .gte("created_at", new Date(systemClock.now().getTime() - 7 * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(100),
    ctx.supabase
      .from("waitlist_entries")
      .select("id, on_date, from_minute, to_minute, status, customers(full_name, phone), services(name), waitlist_offers(status, expires_at, slot_starts_at)")
      .eq("business_id", ctx.business.id)
      .in("status", ["waiting", "offered"])
      .gte("on_date", zonedParts(systemClock.now(), tz).date)
      .order("on_date")
      .order("created_at")
      .limit(100),
    changeVersion(ctx),
    myBilling(ctx),
  ]);
  const inactiveIds = cal.people.filter((p) => !p.active).map((p) => p.id);
  const orphanRows = inactiveIds.length
    ? await ctx.supabase.from("appointments").select("id, starts_at, resource_id, customers(full_name)", { count: "exact" }).eq("business_id", ctx.business.id).in("resource_id", inactiveIds).in("status", ["pending", "confirmed", "cancellation_requested"]).gt("starts_at", systemClock.now().toISOString()).order("starts_at").limit(5)
    : null;
  const orphans = {
    total: orphanRows?.count ?? 0,
    items: ((orphanRows?.data ?? []) as unknown as { id: string; starts_at: string; resource_id: string; customers: { full_name: string } | null }[]).map((o) => ({ id: o.id, date: zonedParts(new Date(o.starts_at), tz).date, start: zonedParts(new Date(o.starts_at), tz).minutes, customer: o.customers?.full_name ?? "", personName: nameOf2(cal, o.resource_id) })),
  };
  if (appts.error || svcs.error || inbox.error || dead.error || wl.error) throw new Error("agenda unavailable");
  const failures = ((dead.data ?? []) as unknown as FailureRow[]).flatMap((r) => {
    const at = r.appointments?.starts_at ?? r.waitlist_offers?.slot_starts_at;
    if (!at) return [];
    const p = zonedParts(new Date(at), tz);
    return [{ id: r.id, kind: r.type, code: r.failure_code, customer: r.appointments?.customers?.full_name ?? r.waitlist_offers?.waitlist_entries?.customers?.full_name ?? "", date: p.date, start: p.minutes }];
  });
  const nameOf = new Map(cal.people.map((p) => [p.id, p.name]));
  const active = cal.people.filter((p) => p.active);
  const shown = personId ? active.filter((p) => p.id === personId) : active;
  const dto = (r: Row) => ({
    personId: r.resource_id,
    personName: nameOf.get(r.resource_id) ?? "",
    id: r.id,
    date: zonedParts(new Date(r.starts_at), tz).date,
    start: zonedParts(new Date(r.starts_at), tz).minutes,
    end: zonedParts(new Date(r.ends_at), tz).minutes || 1440,
    customer: r.customers?.full_name ?? "",
    phone: r.customers?.phone ?? "",
    service: r.service_snapshot.name,
    status: statusOf(r.status),
    manual: r.source === "manual",
    outOfHours: r.out_of_availability,
    ...(r.owner_note ? { note: r.owner_note } : {}),
  });
  const now = systemClock.now();
  const today = zonedParts(now, tz);
  return {
    date,
    today: today.date,
    windows: teamWindowsForDate(date, shown, cal.rules, cal.exceptions).map((w) => ({ from: w.from, to: w.to })),
    person: personId ?? null,
    people: active.map((p) => ({ id: p.id, name: p.name, windows: teamWindowsForDate(date, [p], cal.rules, cal.exceptions).map((w) => ({ from: w.from, to: w.to })) })),
    orphans,
    now: today.date === date ? today.minutes : null,
    appointments: (appts.data as unknown as Row[]).map(dto),
    inbox: (inbox.data as unknown as Row[]).map(dto),
    undelivered: failures.filter((f) => f.code !== "no_email").length,
    undeliveredItems: failures,
    waitlist: (wl.data as unknown as WaitlistRow[]).map((e) => {
      const live = e.waitlist_offers.find((o) => o.status === "pending" && Date.parse(o.expires_at) > systemClock.now().getTime());
      return {
        id: e.id,
        date: e.on_date,
        customer: e.customers?.full_name ?? "",
        phone: e.customers?.phone ?? "",
        service: e.services?.name ?? "",
        fromMinute: e.from_minute,
        toMinute: e.to_minute,
        status: e.status === "offered" && live ? ("offered" as const) : ("waiting" as const),
        offer: live ? { expiresAt: live.expires_at, expiresMinute: zonedParts(new Date(live.expires_at), tz).minutes, slotStartMinute: zonedParts(new Date(live.slot_starts_at), tz).minutes } : null,
      };
    }),
    settings: { waitlistEnabled: ctx.business.waitlist_enabled, waitlistAutoOffer: ctx.business.waitlist_auto_offer },
    billing: { state: billing.state, features: billing.features },
    version,
    services: (svcs.data ?? []).map((s) => ({ id: s.id as string, name: s.name as string, durationMinutes: s.duration_minutes as number })),
    business: { name: ctx.business.name, kind: ctx.business.kind },
  };
}

export function mapError(e: { code?: string | null; message?: string | null }) {
  const m = e.message ?? "";
  if (m.includes("slot_taken")) return fail("SLOT_TAKEN", "בשעה הזו כבר יש תור.");
  if (m.includes("too_early")) return fail("TOO_EARLY", "אפשר לסמן תור כהושלם או כ\"לא הגיע\" רק אחרי שהתחיל.");
  if (m.includes("invalid_transition")) return fail("INVALID_TRANSITION", "התור כבר השתנה. רעננו את הדף.");
  if (m.includes("slot_in_past") || m.includes("slot_too_far")) return fail("INVALID_SLOT", "אפשר להוסיף תור עד 24 שעות אחורה.");
  if (m.includes("service_unavailable")) return fail("SERVICE_UNAVAILABLE", "השירות אינו זמין.");
  if (m.includes("resource_mismatch")) return fail("VALIDATION_FAILED", "האדם שנבחר אינו זמין.");
  if (m.includes("slot_unavailable")) return fail("SLOT_TAKEN", "אי אפשר להציע את השעה הזו: היא תפוסה, קרובה מדי או שכבר יש עליה הצעה.");
  if (m.includes("invalid_state")) return fail("INVALID_TRANSITION", "לממתין כבר יש הצעה או שהוא הוסר. רעננו את הדף.");
  if (m.includes("plan_required") || m.includes("plan_limit") || m.includes("billing_inactive")) return fail("PAYMENT_REQUIRED", m.includes("plan_limit") ? "הגעתם למכסת השירותים בחבילה. שדרגו כדי להוסיף." : m.includes("billing_inactive") ? "המנוי אינו פעיל, ולכן אי אפשר להוסיף תורים חדשים." : "התכונה הזו אינה כלולה במנוי הנוכחי.");
  if (e.code === "42501") return fail("NOT_FOUND", "לא נמצא."); // not yours and not existing look the same
  if (e.code === "28000") return fail("UNAUTHENTICATED", "יש להתחבר מחדש.");
  if (e.code === "23514") return fail("VALIDATION_FAILED", "הבקשה אינה תקינה.");
  console.error(JSON.stringify({ level: "error", msg: "owner rpc failed", code: e.code })); // no PII in logs
  return new Error("owner operation failed");
}

export async function createManual(ctx: OwnerCtx, input: C.CreateManualInput): Promise<z.infer<typeof C.CreateManualResponse>> {
  const phone = normalizePhone(input.customer.phone);
  if (!phone) throw fail("VALIDATION_FAILED", "הבקשה אינה תקינה.", [{ field: "customer.phone", message: "מספר הטלפון אינו תקין." }]);
  const { data: svc } = await ctx.supabase.from("services").select("id, duration_minutes").eq("id", input.serviceId).eq("business_id", ctx.business.id).eq("active", true).maybeSingle();
  if (!svc) throw fail("SERVICE_UNAVAILABLE", "השירות אינו זמין.");
  const startMin = hhmmToMinutes(input.time);
  const cal = await loadTeamCalendar(ctx.supabase, ctx.business.id);
  const active = cal.people.filter((p) => p.active);
  if (input.personId && !active.some((p) => p.id === input.personId)) throw fail("VALIDATION_FAILED", "האדם שנבחר אינו פעיל.", [{ field: "personId", message: "האדם שנבחר אינו פעיל." }]);
  // AVL-10: the owner may book anywhere; whether it falls inside opening hours is computed here (the server knows the rules), never trusted from the client.
  // With a named person only that person's hours count; otherwise anybody's.
  const inside = insideHours({ date: input.date, startMinute: startMin, durationMinutes: svc.duration_minutes as number, people: input.personId ? active.filter((p) => p.id === input.personId) : active, rules: cal.rules, exceptions: cal.exceptions });
  const { data, error } = await ctx.supabase.rpc("create_manual_appointment_team", {
    p_business: ctx.business.id,
    p_service: svc.id,
    p_starts_at: zonedTimeToUtc(input.date, startMin, ctx.business.timezone).toISOString(),
    p_full_name: input.customer.fullName.trim(),
    p_phone: phone,
    p_note: input.note?.trim() || null,
    p_out_of_availability: !inside,
    p_resource: input.personId ?? null,
  });
  if (error) throw mapError(error);
  const r = data as { id: string; reference: string };
  return { id: r.id, reference: r.reference, outOfHours: !inside };
}

/** RSC-04: the owner moves a booking. Whether the new time is inside opening hours is computed here (flag only, as for manual bookings): the owner may book anywhere. */
export async function moveAppointment(ctx: OwnerCtx, id: string, input: z.infer<typeof C.OwnerMoveRequest>): Promise<z.infer<typeof C.OwnerMoveResponse>> {
  const { data: row } = await ctx.supabase.from("appointments").select("service_snapshot, resource_id").eq("id", id).maybeSingle();
  if (!row) throw fail("NOT_FOUND", "לא נמצא.");
  const startMin = hhmmToMinutes(input.time);
  const duration = Number((row.service_snapshot as { durationMinutes?: number }).durationMinutes ?? 30);
  const cal = await loadTeamCalendar(ctx.supabase, ctx.business.id);
  const target = input.personId ?? (row.resource_id as string); // T7: the owner may move it to another person; otherwise it stays with the same one
  const inside = insideHours({ date: input.date, startMinute: startMin, durationMinutes: duration, people: cal.people.filter((p) => p.id === target), rules: cal.rules, exceptions: cal.exceptions });
  const { data, error } = await ctx.supabase.rpc("owner_move_appointment", {
    p_id: id,
    p_new_start: zonedTimeToUtc(input.date, startMin, ctx.business.timezone).toISOString(),
    p_out_of_availability: !inside,
    p_resource: input.personId && input.personId !== row.resource_id ? input.personId : null,
  });
  if (error) {
    if ((error.message ?? "").includes("same_slot")) throw fail("VALIDATION_FAILED", "התור כבר נמצא בשעה הזו.");
    if ((error.message ?? "").includes("slot_in_past")) throw fail("INVALID_SLOT", "אי אפשר להעביר תור לשעה שכבר עברה.");
    throw mapError(error);
  }
  const r = data as { id: string; status: string };
  return { id: r.id, status: r.status, outOfHours: !inside };
}

const DB_ACTION: Record<z.infer<typeof C.OwnerAction>, string> = {
  approve: "approve",
  reject: "reject",
  cancel: "cancel",
  complete: "complete",
  noShow: "no_show",
  approveCancellation: "approve_cancellation",
  declineCancellation: "decline_cancellation",
};

export async function transition(ctx: OwnerCtx, id: string, action: z.infer<typeof C.OwnerAction>): Promise<z.infer<typeof C.OwnerTransitionResponse>> {
  const { data, error } = await ctx.supabase.rpc("transition_appointment", { p_id: id, p_action: DB_ACTION[action] });
  if (error) throw mapError(error);
  const r = data as { id: string; status: string };
  return { id: r.id, status: statusOf(r.status) };
}

/** A cheap marker that changes whenever something the dashboard shows changes (appointments, waitlist, undelivered mail). */
export async function changeVersion(ctx: OwnerCtx): Promise<string> {
  const latest = async (table: string, column: string) => {
    const { data } = await ctx.supabase.from(table).select(column).eq("business_id", ctx.business.id).order(column, { ascending: false }).limit(1);
    return ((data as unknown as Record<string, string>[] | null)?.[0]?.[column] ?? "0") as string;
  };
  const [a, w, n] = await Promise.all([latest("appointments", "updated_at"), latest("waitlist_entries", "updated_at"), latest("notification_log", "created_at")]);
  return `${a}|${w}|${n}`;
}

// ---------------------------------------------------------------- waitlist (owner)
export async function waitlistRemove(ctx: OwnerCtx, id: string): Promise<void> {
  const { error } = await ctx.supabase.rpc("waitlist_owner_remove", { p_entry: id });
  if (error) throw mapError(error);
}

export async function waitlistOffer(ctx: OwnerCtx, id: string, time: string): Promise<void> {
  const { data: e } = await ctx.supabase.from("waitlist_entries").select("on_date").eq("id", id).eq("business_id", ctx.business.id).maybeSingle();
  if (!e) throw fail("NOT_FOUND", "לא נמצא.");
  const startsAt = zonedTimeToUtc(e.on_date as string, hhmmToMinutes(time), ctx.business.timezone);
  const { error } = await ctx.supabase.rpc("waitlist_manual_offer", { p_entry: id, p_starts_at: startsAt.toISOString() });
  if (error) throw mapError(error);
}

export async function waitlistSettings(ctx: OwnerCtx, input: { autoOffer?: boolean; enabled?: boolean }): Promise<void> {
  if (input.enabled === true || input.autoOffer === true) await requireFeature(ctx, "waitlist"); // BIL-08
  const patch = { ...(input.autoOffer !== undefined ? { waitlist_auto_offer: input.autoOffer } : {}), ...(input.enabled !== undefined ? { waitlist_enabled: input.enabled } : {}) };
  const { data, error } = await ctx.supabase.from("businesses").update(patch).eq("id", ctx.business.id).select("id");
  if (error) throw mapError(error);
  if (!data?.length) throw fail("FORBIDDEN", "רק מנהל העסק יכול לשנות את ההגדרה.");
}

const nameOf2 = (cal: { people: { id: string; name: string }[] }, id: string) => cal.people.find((p) => p.id === id)?.name ?? "";
