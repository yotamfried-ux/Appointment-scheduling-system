import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type * as C from "@/lib/api/contracts";
import { fail } from "@/lib/api/http";
import { hasRequiredAssurance } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { addDaysIso, windowsForDate } from "@/modules/availability/slots";
import { loadAvailability } from "@/modules/availability/repo";
import { rowsToExceptions, rowsToRules } from "@/modules/availability/schema";
import type { BusinessKindId } from "@/modules/tenancy/business-kind";
import { systemClock, zonedParts, zonedTimeToUtc } from "@/platform/clock";

// Owner operations run as the signed-in user: Row Level Security decides what is visible, the RPCs decide what may change.
// The business is derived from the session (first membership), never from anything the request says.
export interface OwnerCtx {
  supabase: SupabaseClient;
  business: { id: string; name: string; kind: BusinessKindId; timezone: string; waitlist_enabled: boolean; waitlist_auto_offer: boolean };
}

export async function ownerContext(): Promise<OwnerCtx> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) throw fail("UNAUTHENTICATED", "יש להתחבר מחדש.");
  if (!(await hasRequiredAssurance(supabase))) throw fail("UNAUTHENTICATED", "נדרש אימות דו-שלבי.");
  const { data: rows } = await supabase.from("businesses").select("id, name, kind, timezone, waitlist_enabled, waitlist_auto_offer").order("created_at").limit(1);
  const b = rows?.[0] as OwnerCtx["business"] | undefined;
  if (!b) throw fail("FORBIDDEN", "אין עסק מקושר לחשבון.");
  return { supabase, business: b };
}

const hhmmToMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const statusOf = (s: string): z.infer<typeof C.OwnerStatus> =>
  s === "cancellation_requested" ? "cancellationRequested" : s === "no_show" ? "noShow" : s.startsWith("cancelled") ? "cancelled" : (s as "confirmed" | "pending" | "completed");

const COLUMNS = "id, status, starts_at, ends_at, source, out_of_availability, owner_note, service_snapshot, customers(full_name, phone)";

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
  service_snapshot: { name: string };
  customers: { full_name: string; phone: string } | null;
}

export async function agenda(ctx: OwnerCtx, date: string): Promise<z.infer<typeof C.OwnerAgendaResponse>> {
  const tz = ctx.business.timezone;
  const from = zonedTimeToUtc(date, 0, tz);
  const to = zonedTimeToUtc(addDaysIso(date, 1), 0, tz);
  const [appts, av, svcs, inbox, dead, wl, version] = await Promise.all([
    ctx.supabase
      .from("appointments")
      .select(COLUMNS)
      .eq("business_id", ctx.business.id)
      .gte("starts_at", from.toISOString())
      .lt("starts_at", to.toISOString())
      .order("starts_at")
      .limit(300),
    loadAvailability(ctx.supabase, ctx.business.id),
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
      .select("id", { count: "exact", head: true })
      .eq("business_id", ctx.business.id)
      .eq("status", "dead")
      .gte("created_at", new Date(systemClock.now().getTime() - 7 * 86_400_000).toISOString()),
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
  ]);
  if (appts.error || svcs.error || inbox.error || dead.error || wl.error) throw new Error("agenda unavailable");
  const dto = (r: Row) => ({
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
    windows: windowsForDate(date, rowsToRules(av.rules), rowsToExceptions(av.exceptions)).map((w) => ({ from: w.from, to: w.to })),
    now: today.date === date ? today.minutes : null,
    appointments: (appts.data as unknown as Row[]).map(dto),
    inbox: (inbox.data as unknown as Row[]).map(dto),
    undelivered: dead.count ?? 0,
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
    version,
    services: (svcs.data ?? []).map((s) => ({ id: s.id as string, name: s.name as string, durationMinutes: s.duration_minutes as number })),
    business: { name: ctx.business.name, kind: ctx.business.kind },
  };
}

function mapError(e: { code?: string | null; message?: string | null }) {
  const m = e.message ?? "";
  if (m.includes("slot_taken")) return fail("SLOT_TAKEN", "בשעה הזו כבר יש תור.");
  if (m.includes("too_early")) return fail("TOO_EARLY", "אפשר לסמן תור כהושלם או כ\"לא הגיע\" רק אחרי שהתחיל.");
  if (m.includes("invalid_transition")) return fail("INVALID_TRANSITION", "התור כבר השתנה. רעננו את הדף.");
  if (m.includes("slot_in_past") || m.includes("slot_too_far")) return fail("INVALID_SLOT", "אפשר להוסיף תור עד 24 שעות אחורה.");
  if (m.includes("service_unavailable")) return fail("SERVICE_UNAVAILABLE", "השירות אינו זמין.");
  if (m.includes("slot_unavailable")) return fail("SLOT_TAKEN", "אי אפשר להציע את השעה הזו: היא תפוסה, קרובה מדי או שכבר יש עליה הצעה.");
  if (m.includes("invalid_state")) return fail("INVALID_TRANSITION", "לממתין כבר יש הצעה או שהוא הוסר. רעננו את הדף.");
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
  const av = await loadAvailability(ctx.supabase, ctx.business.id);
  // AVL-10: the owner may book anywhere; whether it falls inside opening hours is computed here (the server knows the rules), never trusted from the client.
  const inside = windowsForDate(input.date, rowsToRules(av.rules), rowsToExceptions(av.exceptions)).some((w) => startMin >= w.from && startMin + (svc.duration_minutes as number) <= w.to);
  const { data, error } = await ctx.supabase.rpc("create_manual_appointment", {
    p_business: ctx.business.id,
    p_service: svc.id,
    p_starts_at: zonedTimeToUtc(input.date, startMin, ctx.business.timezone).toISOString(),
    p_full_name: input.customer.fullName.trim(),
    p_phone: phone,
    p_note: input.note?.trim() || null,
    p_out_of_availability: !inside,
  });
  if (error) throw mapError(error);
  const r = data as { id: string; reference: string };
  return { id: r.id, reference: r.reference, outOfHours: !inside };
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
  const patch = { ...(input.autoOffer !== undefined ? { waitlist_auto_offer: input.autoOffer } : {}), ...(input.enabled !== undefined ? { waitlist_enabled: input.enabled } : {}) };
  const { data, error } = await ctx.supabase.from("businesses").update(patch).eq("id", ctx.business.id).select("id");
  if (error) throw mapError(error);
  if (!data?.length) throw fail("FORBIDDEN", "רק מנהל העסק יכול לשנות את ההגדרה.");
}
