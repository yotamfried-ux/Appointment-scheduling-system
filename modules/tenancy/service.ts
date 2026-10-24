import "server-only";
// Tenancy service: runs with the USER's Supabase client (publishable key + their JWT), so RLS always applies.
// Writes go through the RPCs (supabase/migrations/*_tenancy_core.sql); the system-db (secret key) path is never used here.
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapRpcError, type TenancyErrorCode } from "@/modules/tenancy/errors";
import { slugCandidates, type CreateBusinessInput } from "@/modules/tenancy/schema";

export type Result<T> = { ok: true; value: T } | { ok: false; code: TenancyErrorCode };

export interface BusinessSummary {
  id: string;
  slug: string;
  name: string;
  kind: string;
  published_at: string | null;
}

export async function createBusiness(supabase: SupabaseClient, input: CreateBusinessInput): Promise<Result<BusinessSummary>> {
  for (const slug of slugCandidates(input.name, Math.random, input.slug)) {
    const { data, error } = await supabase.rpc("create_business", {
      p_name: input.name,
      p_kind: input.kind,
      p_phone: input.phone,
      p_slug: slug,
      p_services: input.services,
      p_hours: input.hours,
    });
    if (!error) return { ok: true, value: data as BusinessSummary };
    const code = mapRpcError(error);
    if (code !== "SLUG_TAKEN") return { ok: false, code };
  }
  return { ok: false, code: "SLUG_TAKEN" };
}

export async function listMyBusinesses(supabase: SupabaseClient): Promise<BusinessSummary[]> {
  const { data } = await supabase.from("businesses").select("id, slug, name, kind, published_at").order("created_at");
  return (data ?? []) as BusinessSummary[];
}

export async function publishBusiness(supabase: SupabaseClient, businessId: string): Promise<Result<BusinessSummary>> {
  const { data, error } = await supabase.rpc("publish_business", { p_business: businessId });
  return error ? { ok: false, code: mapRpcError(error) } : { ok: true, value: data as BusinessSummary };
}
