"use server";

import { revalidatePath } from "next/cache";
import { hasRequiredAssurance } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ExceptionInput, WeeklyHoursInput } from "@/modules/availability/schema";
import { addException, loadAvailability, removeException, replaceWeeklyHours, type AvailabilityErrorCode } from "@/modules/availability/repo";
import { BookingRulesInput } from "@/modules/tenancy/booking-rules";
import { ServiceInput, type CatalogErrorCode } from "@/modules/catalog/schema";
import { saveService, setServiceActive } from "@/modules/catalog/service";
import { listMyBusinesses } from "@/modules/tenancy/service";

// Owner settings actions. The tenant is the signed-in user's business (never taken from the request); RLS enforces roles in the database.
type Ok = { ok: true };
type Fail<C extends string> = { ok: false; code: C };

async function context() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { ok: false as const, error: "NOT_AUTHENTICATED" as const };
  if (!(await hasRequiredAssurance(supabase))) return { ok: false as const, error: "FORBIDDEN" as const };
  const business = (await listMyBusinesses(supabase))[0];
  if (!business) return { ok: false as const, error: "FORBIDDEN" as const };
  return { ok: true as const, supabase, businessId: business.id };
}

export async function saveServiceAction(raw: unknown): Promise<Ok | Fail<CatalogErrorCode>> {
  const c = await context();
  if (!c.ok) return { ok: false, code: c.error };
  const parsed = ServiceInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const r = await saveService(c.supabase, c.businessId, parsed.data);
  if (r.ok) revalidatePath("/settings/services");
  return r;
}

export async function setServiceActiveAction(id: unknown, active: unknown): Promise<Ok | Fail<CatalogErrorCode>> {
  const c = await context();
  if (!c.ok) return { ok: false, code: c.error };
  if (typeof id !== "string" || typeof active !== "boolean") return { ok: false, code: "VALIDATION" };
  const r = await setServiceActive(c.supabase, c.businessId, id, active);
  if (r.ok) revalidatePath("/settings/services");
  return r;
}

export async function saveHoursAction(raw: unknown): Promise<Ok | Fail<AvailabilityErrorCode>> {
  const c = await context();
  if (!c.ok) return { ok: false, code: c.error };
  const parsed = WeeklyHoursInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const r = await replaceWeeklyHours(c.supabase, c.businessId, parsed.data);
  if (r.ok) revalidatePath("/settings/hours");
  return r;
}

export async function addExceptionAction(raw: unknown): Promise<Ok | Fail<AvailabilityErrorCode>> {
  const c = await context();
  if (!c.ok) return { ok: false, code: c.error };
  const parsed = ExceptionInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const { resourceId } = await loadAvailability(c.supabase, c.businessId);
  if (!resourceId) return { ok: false, code: "FORBIDDEN" };
  const r = await addException(c.supabase, c.businessId, resourceId, parsed.data);
  if (r.ok) revalidatePath("/settings/hours");
  return r;
}

export async function removeExceptionAction(id: unknown): Promise<Ok | Fail<AvailabilityErrorCode>> {
  const c = await context();
  if (!c.ok) return { ok: false, code: c.error };
  const r = await removeException(c.supabase, c.businessId, id);
  if (r.ok) revalidatePath("/settings/hours");
  return r;
}

/** Booking rules and the no-show policy. Admins and owners only: the database (RLS + column grants) is the gate, this reports its refusal. */
export async function saveBookingRulesAction(raw: unknown): Promise<Ok | Fail<"NOT_AUTHENTICATED" | "FORBIDDEN" | "VALIDATION" | "FAILED">> {
  const c = await context();
  if (!c.ok) return { ok: false, code: c.error };
  const p = BookingRulesInput.safeParse(raw);
  if (!p.success) return { ok: false, code: "VALIDATION" };
  const r = p.data;
  const { data, error } = await c.supabase.from("businesses").update({
    requires_approval: r.requiresApproval, cancel_until_hours: r.cancelUntilHours, min_notice_minutes: r.minNoticeMinutes, booking_horizon_days: r.horizonDays,
    address: r.address, no_show_policy: r.noShowPolicy, no_show_threshold: r.noShowThreshold, block_message: r.blockMessage === "" ? null : r.blockMessage,
    attendance_alert_minutes: r.attendanceAlertMinutes, auto_complete_hours: r.autoCompleteHours, digest_frequency: r.digestFrequency, reschedule_service_change: r.rescheduleServiceChange,
  }).eq("id", c.businessId).select("id");
  if (error) return { ok: false, code: "FAILED" };
  if (!data?.length) return { ok: false, code: "FORBIDDEN" }; // RLS filtered the update: not an admin
  revalidatePath("/settings/booking");
  return { ok: true };
}
