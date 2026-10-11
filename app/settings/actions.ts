"use server";

import { revalidatePath } from "next/cache";
import { hasRequiredAssurance } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ExceptionInput, WeeklyHoursInput } from "@/modules/availability/schema";
import { addException, loadAvailability, removeException, replaceWeeklyHours, type AvailabilityErrorCode } from "@/modules/availability/repo";
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
