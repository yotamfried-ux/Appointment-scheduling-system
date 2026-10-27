import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminBusiness, AdminSystemError, DashboardMetrics } from "./types";

/**
 * Checks whether the current authenticated user is a verified platform administrator.
 * Validates against public.platform_admins via the secure server-side RPC.
 */
export async function isPlatformAdmin(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error || !data) return false;
  return Boolean(data);
}

/**
 * Retrieves aggregate platform metrics for the admin dashboard.
 */
export async function getDashboardMetrics(
  supabase: SupabaseClient,
  opts: { from?: string; to?: string } = {}
): Promise<DashboardMetrics> {
  const { data, error } = await supabase.rpc("admin_dashboard_metrics", {
    p_from: opts.from ?? null,
    p_to: opts.to ?? null,
  });
  if (error) {
    throw new Error(`Failed to load admin dashboard metrics: ${error.message}`);
  }
  return data as DashboardMetrics;
}

/**
 * Retrieves business directory items with usage and health aggregates (zero customer PII).
 */
export async function listBusinesses(
  supabase: SupabaseClient,
  opts: {
    search?: string;
    status?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<AdminBusiness[]> {
  const { data, error } = await supabase.rpc("admin_list_businesses", {
    p_search: opts.search?.trim() || null,
    p_status: opts.status?.trim() || null,
    p_from: opts.from ?? null,
    p_to: opts.to ?? null,
    p_limit: opts.limit ?? 100,
    p_offset: opts.offset ?? 0,
  });
  if (error) {
    throw new Error(`Failed to list businesses: ${error.message}`);
  }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    kind: String(row.kind),
    phone: row.phone ? String(row.phone) : null,
    published_at: row.published_at ? String(row.published_at) : null,
    created_at: String(row.created_at),
    owner_email: row.owner_email ? String(row.owner_email) : null,
    total_appointments: Number(row.total_appointments ?? 0),
    cancelled_appointments: Number(row.cancelled_appointments ?? 0),
    cancellation_rate: Number(row.cancellation_rate ?? 0),
    services_count: Number(row.services_count ?? 0),
    staff_count: Number(row.staff_count ?? 0),
    waitlist_enabled: Boolean(row.waitlist_enabled),
    subscription_tier: row.subscription_tier ? String(row.subscription_tier) : "free",
    subscription_type: (row.subscription_type as AdminBusiness["subscription_type"]) ?? "free",
  }));
}

/**
 * Retrieves recent operational system errors for the admin dashboard.
 */
export async function getSystemErrors(
  supabase: SupabaseClient,
  limit: number = 50
): Promise<AdminSystemError[]> {
  const { data, error } = await supabase.rpc("admin_system_errors", {
    p_limit: limit,
  });
  if (error) {
    throw new Error(`Failed to load system errors: ${error.message}`);
  }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    category: String(row.category),
    type: String(row.type),
    error_message: String(row.error_message),
    business_name: String(row.business_name),
    created_at: String(row.created_at),
  }));
}
