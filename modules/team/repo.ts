import "server-only";
// Team settings repository: runs with the USER's client, so RLS (members read) and the audited admin RPCs are the authority. No secret-key client here.
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapTeamError, type TeamErrorCode, type TeamPersonRow } from "@/modules/team/schema";
import type { RuleRow } from "@/modules/availability/schema";

export type TeamResult<T = object> = ({ ok: true } & T) | { ok: false; code: TeamErrorCode };

export async function listTeam(supabase: SupabaseClient, businessId: string): Promise<TeamPersonRow[]> {
  const [people, future] = await Promise.all([
    supabase.from("resources").select("id, name, active, is_default, position").eq("business_id", businessId).order("active", { ascending: false }).order("position").order("created_at"),
    supabase.from("appointments").select("resource_id").eq("business_id", businessId).in("status", ["pending", "confirmed", "cancellation_requested"]).gt("starts_at", new Date().toISOString()).limit(5000),
  ]);
  const counts = new Map<string, number>();
  for (const r of future.data ?? []) counts.set(r.resource_id as string, (counts.get(r.resource_id as string) ?? 0) + 1);
  return (people.data ?? []).map((p) => ({ id: p.id as string, name: p.name as string, active: p.active as boolean, isDefault: p.is_default as boolean, position: p.position as number, futureAppointments: counts.get(p.id as string) ?? 0 }));
}

export async function loadStaffRules(supabase: SupabaseClient, businessId: string): Promise<Map<string, RuleRow[]>> {
  const { data } = await supabase.from("availability_rules").select("resource_id, weekday, start_minute, end_minute").eq("business_id", businessId);
  const out = new Map<string, RuleRow[]>();
  for (const r of data ?? []) out.set(r.resource_id as string, [...(out.get(r.resource_id as string) ?? []), { weekday: r.weekday as number, start_minute: r.start_minute as number, end_minute: r.end_minute as number }]);
  return out;
}

/** serviceId → the people it is restricted to (a service without an entry is open to everybody). */
export async function loadServiceStaff(supabase: SupabaseClient, businessId: string): Promise<Map<string, string[]>> {
  const { data } = await supabase.from("service_staff").select("service_id, resource_id").eq("business_id", businessId);
  const out = new Map<string, string[]>();
  for (const r of data ?? []) out.set(r.service_id as string, [...(out.get(r.service_id as string) ?? []), r.resource_id as string]);
  return out;
}

export async function createStaff(supabase: SupabaseClient, businessId: string, name: string): Promise<TeamResult<{ id: string }>> {
  const { data, error } = await supabase.rpc("create_staff", { p_business: businessId, p_name: name });
  return error ? { ok: false, code: mapTeamError(error) } : { ok: true, id: data as string };
}

export async function updateStaff(supabase: SupabaseClient, id: string, change: { name?: string; active?: boolean }): Promise<TeamResult<{ futureAppointments: number }>> {
  const { data, error } = await supabase.rpc("update_staff", { p_resource: id, p_name: change.name ?? null, p_active: change.active ?? null });
  if (error) return { ok: false, code: mapTeamError(error) };
  return { ok: true, futureAppointments: Number((data as { futureAppointments?: number } | null)?.futureAppointments ?? 0) };
}

export async function setServiceStaff(supabase: SupabaseClient, serviceId: string, resourceIds: string[]): Promise<TeamResult> {
  const { error } = await supabase.rpc("set_service_staff", { p_service: serviceId, p_resources: resourceIds });
  return error ? { ok: false, code: mapTeamError(error) } : { ok: true };
}

export async function setStaffHours(supabase: SupabaseClient, resourceId: string, hours: unknown): Promise<TeamResult> {
  const { error } = await supabase.rpc("set_staff_hours", { p_resource: resourceId, p_hours: hours });
  return error ? { ok: false, code: mapTeamError(error) } : { ok: true };
}
