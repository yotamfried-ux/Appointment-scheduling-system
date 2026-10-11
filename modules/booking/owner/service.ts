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
  business: { id: string; name: string; kind: BusinessKindId; timezone: string };
}

export async function ownerContext(): Promise<OwnerCtx> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) throw fail("UNAUTHENTICATED", "יש להתחבר מחדש.");
  if (!(await hasRequiredAssurance(supabase))) throw fail("UNAUTHENTICATED", "נדרש אימות דו-שלבי.");
  const { data: rows } = await supabase.from("businesses").select("id, name, kind, timezone").order("created_at").limit(1);
  const b = rows?.[0] as OwnerCtx["business"] | undefined;
  if (!b) throw fail("FORBIDDEN", "אין עסק מקושר לחשבון.");
  return { supabase, business: b };
}

const hhmmToMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const statusOf = (s: string): z.infer<typeof C.OwnerStatus> =>
  s === "cancellation_requested" ? "cancellationRequested" : s === "no_show" ? "noShow" : s.startsWith("cancelled") ? "cancelled" : (s as "confirmed" | "pending" | "completed");

const COLUMNS = "id, status, starts_at, ends_at, source, out_of_availability, owner_note, service_snapshot, customers(full_name, phone)";

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
  const [appts, av, svcs, inbox] = await Promise.all([
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
  ]);
  if (appts.error || svcs.error || inbox.error) throw new Error("agenda unavailable");
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
