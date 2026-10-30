-- Fix public admin wrapper functions to be SECURITY INVOKER instead of SECURITY DEFINER
-- This eliminates definer_in_exposed_schema lint violations while preserving private.* SECURITY DEFINER logic.

create or replace function public.admin_dashboard_metrics(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.admin_dashboard_metrics(p_from, p_to);
$$;

revoke all on function public.admin_dashboard_metrics(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_dashboard_metrics(timestamptz, timestamptz) to authenticated;

create or replace function public.admin_list_businesses(
  p_search text default null,
  p_status text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit int default 100,
  p_offset int default 0
) returns table (
  id uuid,
  name text,
  slug text,
  kind text,
  phone text,
  published_at timestamptz,
  created_at timestamptz,
  owner_email text,
  total_appointments bigint,
  cancelled_appointments bigint,
  cancellation_rate numeric,
  services_count bigint,
  staff_count bigint,
  waitlist_enabled boolean,
  subscription_tier text,
  subscription_type text
) language sql stable security invoker set search_path = '' as $$
  select * from private.admin_list_businesses(p_search, p_status, p_from, p_to, p_limit, p_offset);
$$;

revoke all on function public.admin_list_businesses(text, text, timestamptz, timestamptz, int, int) from public, anon;
grant execute on function public.admin_list_businesses(text, text, timestamptz, timestamptz, int, int) to authenticated;
