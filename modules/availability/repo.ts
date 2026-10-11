import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { exceptionToRow, type ExceptionInput, type ExceptionRow, type RuleRow } from "@/modules/availability/schema";

export type AvailabilityErrorCode = "NOT_AUTHENTICATED" | "FORBIDDEN" | "VALIDATION" | "OVERLAP" | "INTERNAL";
export type AvailabilityResult = { ok: true } | { ok: false; code: AvailabilityErrorCode };

const mapError = (e: { code?: string | null } | null): AvailabilityErrorCode =>
  e?.code === "42501" ? "FORBIDDEN" : e?.code === "23P01" ? "OVERLAP" : e?.code === "23514" ? "VALIDATION" : "INTERNAL";

export async function loadAvailability(supabase: SupabaseClient, businessId: string): Promise<{ rules: RuleRow[]; exceptions: ExceptionRow[]; resourceId: string | null }> {
  const [rules, exceptions, resource] = await Promise.all([
    supabase.from("availability_rules").select("weekday, start_minute, end_minute").eq("business_id", businessId),
    supabase.from("availability_exceptions").select("id, on_date, kind, start_minute, end_minute, note").eq("business_id", businessId).order("on_date"),
    supabase.from("resources").select("id").eq("business_id", businessId).eq("is_default", true).maybeSingle(),
  ]);
  return { rules: (rules.data ?? []) as RuleRow[], exceptions: (exceptions.data ?? []) as ExceptionRow[], resourceId: (resource.data?.id as string | undefined) ?? null };
}

export async function replaceWeeklyHours(supabase: SupabaseClient, businessId: string, hours: unknown): Promise<AvailabilityResult> {
  const { error } = await supabase.rpc("replace_weekly_hours", { p_business: businessId, p_hours: hours });
  return error ? { ok: false, code: mapError(error) } : { ok: true };
}

export async function addException(supabase: SupabaseClient, businessId: string, resourceId: string, input: ExceptionInput): Promise<AvailabilityResult> {
  const { error } = await supabase.from("availability_exceptions").insert({ business_id: businessId, resource_id: resourceId, ...exceptionToRow(input) });
  return error ? { ok: false, code: mapError(error) } : { ok: true };
}

export async function removeException(supabase: SupabaseClient, businessId: string, id: unknown): Promise<AvailabilityResult> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const { error } = await supabase.from("availability_exceptions").delete().eq("id", parsed.data).eq("business_id", businessId);
  return error ? { ok: false, code: mapError(error) } : { ok: true };
}
