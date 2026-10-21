import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { exceptionToRow, type ExceptionInput, type ExceptionRow, type RuleRow } from "@/modules/availability/schema";

export type AvailabilityErrorCode = "NOT_AUTHENTICATED" | "FORBIDDEN" | "VALIDATION" | "OVERLAP" | "INTERNAL";
export type AvailabilityResult = { ok: true } | { ok: false; code: AvailabilityErrorCode };

const mapError = (e: { code?: string | null } | null): AvailabilityErrorCode =>
  e?.code === "42501" ? "FORBIDDEN" : e?.code === "23P01" ? "OVERLAP" : e?.code === "23514" ? "VALIDATION" : "INTERNAL";

/** One person's weekly hours (the default person when none is named) plus the exceptions that apply to them: business-wide ones and their own (T9). */
export async function loadAvailability(supabase: SupabaseClient, businessId: string, resourceId?: string): Promise<{ rules: RuleRow[]; exceptions: ExceptionRow[]; resourceId: string | null }> {
  let id = resourceId ?? null;
  if (!id) {
    const r = await supabase.from("resources").select("id").eq("business_id", businessId).eq("is_default", true).maybeSingle();
    id = (r.data?.id as string | undefined) ?? null;
  }
  if (!id) return { rules: [], exceptions: [], resourceId: null };
  const [rules, exceptions] = await Promise.all([
    supabase.from("availability_rules").select("weekday, start_minute, end_minute").eq("business_id", businessId).eq("resource_id", id),
    supabase.from("availability_exceptions").select("id, on_date, kind, start_minute, end_minute, note").eq("business_id", businessId).or(`resource_id.is.null,resource_id.eq.${id}`).order("on_date"),
  ]);
  return { rules: (rules.data ?? []) as RuleRow[], exceptions: (exceptions.data ?? []) as ExceptionRow[], resourceId: id };
}

export async function replaceWeeklyHours(supabase: SupabaseClient, businessId: string, hours: unknown): Promise<AvailabilityResult> {
  const { error } = await supabase.rpc("replace_weekly_hours", { p_business: businessId, p_hours: hours });
  return error ? { ok: false, code: mapError(error) } : { ok: true };
}

/** A closure or special opening of the whole business (no person): it applies to everybody (T9). */
export async function addException(supabase: SupabaseClient, businessId: string, input: ExceptionInput): Promise<AvailabilityResult> {
  const { error } = await supabase.from("availability_exceptions").insert({ business_id: businessId, resource_id: null, ...exceptionToRow(input) });
  return error ? { ok: false, code: mapError(error) } : { ok: true };
}

export async function removeException(supabase: SupabaseClient, businessId: string, id: unknown): Promise<AvailabilityResult> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const { error } = await supabase.from("availability_exceptions").delete().eq("id", parsed.data).eq("business_id", businessId);
  return error ? { ok: false, code: mapError(error) } : { ok: true };
}
