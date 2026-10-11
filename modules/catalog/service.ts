import "server-only";
// Catalog service: runs with the USER's client, so RLS (members read, admins write) is the authority.
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapCatalogError, toCents, type CatalogErrorCode, type ServiceInput, type ServiceRow } from "@/modules/catalog/schema";

export type CatalogResult = { ok: true } | { ok: false; code: CatalogErrorCode };

export async function listServices(supabase: SupabaseClient, businessId: string): Promise<ServiceRow[]> {
  const { data } = await supabase
    .from("services")
    .select("id, name, description, duration_minutes, buffer_minutes, price_cents, capacity, active, position")
    .eq("business_id", businessId)
    .order("active", { ascending: false })
    .order("position")
    .order("created_at");
  return (data ?? []) as ServiceRow[];
}

export async function saveService(supabase: SupabaseClient, businessId: string, input: ServiceInput): Promise<CatalogResult> {
  const row = {
    name: input.name,
    description: input.description || null,
    duration_minutes: input.durationMinutes,
    buffer_minutes: input.bufferMinutes,
    price_cents: toCents(input.priceNis),
    capacity: input.capacity,
  };
  const { error } = input.id
    ? await supabase.from("services").update(row).eq("id", input.id).eq("business_id", businessId)
    : await supabase.from("services").insert({ ...row, business_id: businessId, position: 1000 });
  return error ? { ok: false, code: mapCatalogError(error) } : { ok: true };
}

export async function setServiceActive(supabase: SupabaseClient, businessId: string, id: string, active: boolean): Promise<CatalogResult> {
  const { error } = await supabase.from("services").update({ active }).eq("id", id).eq("business_id", businessId);
  return error ? { ok: false, code: mapCatalogError(error) } : { ok: true };
}
