"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRequiredAssurance } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ExceptionInput, WeeklyHoursInput } from "@/modules/availability/schema";
import { addException, removeException, replaceWeeklyHours, type AvailabilityErrorCode } from "@/modules/availability/repo";
import { BookingRulesInput } from "@/modules/tenancy/booking-rules";
import { ServiceInput, type CatalogErrorCode } from "@/modules/catalog/schema";
import { saveService, setServiceActive } from "@/modules/catalog/service";
import { createStaff, setServiceStaff, setStaffHours, updateStaff } from "@/modules/team/repo";
import { ServiceStaffInput, StaffNameInput, StaffUpdateInput, type TeamErrorCode } from "@/modules/team/schema";
import { mapRpcError } from "@/modules/tenancy/errors";
import { listMyBusinesses } from "@/modules/tenancy/service";
import { sessionIsLive } from "@/lib/auth/live-session";

// Owner settings actions. The tenant is the signed-in user's business (never taken from the request); RLS enforces roles in the database.
type Ok = { ok: true };
type Fail<C extends string> = { ok: false; code: C };

async function context() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims || !(await sessionIsLive(supabase))) return { ok: false as const, error: "NOT_AUTHENTICATED" as const };
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
  const r = await addException(c.supabase, c.businessId, parsed.data);
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

// ---------------------------------------------------------------- team (stage 16). Admins and owners only: the audited RPCs and RLS are the gate, these report their refusal.
type TeamFail = Fail<TeamErrorCode>;

export async function createStaffAction(raw: unknown): Promise<{ ok: true; id: string } | TeamFail> {
  const c = await context();
  if (!c.ok) return { ok: false, code: c.error };
  const name = StaffNameInput.safeParse(raw);
  if (!name.success) return { ok: false, code: "VALIDATION" };
  const r = await createStaff(c.supabase, c.businessId, name.data);
  if (r.ok) revalidatePath("/settings/team");
  return r;
}

export async function updateStaffAction(raw: unknown): Promise<{ ok: true; futureAppointments: number } | TeamFail> {
  const c = await context();
  if (!c.ok) return { ok: false, code: c.error };
  const p = StaffUpdateInput.safeParse(raw);
  if (!p.success) return { ok: false, code: "VALIDATION" };
  const r = await updateStaff(c.supabase, p.data.id, { name: p.data.name, active: p.data.active });
  if (r.ok) revalidatePath("/settings/team");
  return r;
}

export async function setServiceStaffAction(raw: unknown): Promise<Ok | TeamFail> {
  const c = await context();
  if (!c.ok) return { ok: false, code: c.error };
  const p = ServiceStaffInput.safeParse(raw);
  if (!p.success) return { ok: false, code: "VALIDATION" };
  const r = await setServiceStaff(c.supabase, p.data.serviceId, p.data.resourceIds);
  if (r.ok) revalidatePath("/settings/team");
  return r;
}

export async function saveStaffHoursAction(resourceId: unknown, raw: unknown): Promise<Ok | TeamFail> {
  const c = await context();
  if (!c.ok) return { ok: false, code: c.error };
  const id = z.uuid().safeParse(resourceId);
  const hours = WeeklyHoursInput.safeParse(raw);
  if (!id.success || !hours.success) return { ok: false, code: "VALIDATION" };
  const r = await setStaffHours(c.supabase, id.data, hours.data);
  if (r.ok) revalidatePath("/settings/team");
  return r;
}

// ---------------------------------------------------------------- the booking link. The owner chooses the short name; the database refuses reserved or taken names and keeps the old link working as a redirect.
const SlugInput = z.string().trim().toLowerCase().min(3).max(40).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
type SlugFail = Fail<"NOT_AUTHENTICATED" | "FORBIDDEN" | "VALIDATION" | "RATE_LIMITED" | "FAILED">;

export async function checkSlugAction(raw: unknown): Promise<{ ok: true; available: boolean } | SlugFail> {
  const c = await context();
  if (!c.ok) return { ok: false, code: c.error };
  const p = SlugInput.safeParse(raw);
  if (!p.success) return { ok: false, code: "VALIDATION" };
  const { data, error } = await c.supabase.rpc("slug_available", { p_slug: p.data });
  if (error) return { ok: false, code: mapRpcError(error) === "RATE_LIMITED" ? "RATE_LIMITED" : "FAILED" };
  return { ok: true, available: data === true };
}

export async function changeSlugAction(raw: unknown): Promise<{ ok: true; slug: string } | Fail<"NOT_AUTHENTICATED" | "FORBIDDEN" | "VALIDATION" | "SLUG_TAKEN" | "TOO_MANY_CHANGES" | "FAILED">> {
  const c = await context();
  if (!c.ok) return { ok: false, code: c.error };
  const p = SlugInput.safeParse(raw);
  if (!p.success) return { ok: false, code: "VALIDATION" };
  const { data, error } = await c.supabase.rpc("change_business_slug", { p_business: c.businessId, p_new_slug: p.data });
  if (error) {
    if ((error.message ?? "").includes("redirect_limit")) return { ok: false, code: "TOO_MANY_CHANGES" };
    const code = mapRpcError(error);
    return { ok: false, code: code === "SLUG_TAKEN" ? "SLUG_TAKEN" : code === "FORBIDDEN" ? "FORBIDDEN" : code === "SLUG_INVALID" ? "VALIDATION" : "FAILED" };
  }
  revalidatePath("/settings/booking");
  revalidatePath("/dashboard");
  return { ok: true, slug: (data as { slug?: string } | null)?.slug ?? p.data };
}
