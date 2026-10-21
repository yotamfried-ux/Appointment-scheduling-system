-- Speed: the public availability and slots calls used to make three separate round trips to the database (rate-limit counter, catalog, busy times).
-- This one function does all three in a single call. Same rules as before: the counter is hit first (a refused request reads nothing else), unknown and unpublished
-- businesses look identical (null), an old slug returns the redirect, and the busy window is the requested days plus a day on each side (as in the application code).
-- System path only (service_role), like the three functions it combines.

create function private.public_range(p_slug text, p_from date, p_days int, p_key text, p_window_seconds int, p_max int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_cat jsonb;
  v_rate jsonb;
  v_busy jsonb := '[]'::jsonb;
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
begin
  select * into r from private.rate_limit_hit(p_key, p_window_seconds, p_max);
  v_rate := jsonb_build_object('allowed', r.allowed, 'retry_after', r.retry_after);
  if not r.allowed then return jsonb_build_object('rate', v_rate); end if;
  v_cat := private.public_catalog(p_slug);
  if v_cat is null or (v_cat ->> 'redirect') is not null then return jsonb_build_object('rate', v_rate, 'catalog', v_cat); end if;
  v_tz := v_cat -> 'business' ->> 'timezone';
  v_from := (p_from::timestamp at time zone v_tz) - interval '24 hours';
  v_to := ((p_from + p_days)::timestamp at time zone v_tz) + interval '24 hours';
  select coalesce(jsonb_agg(jsonb_build_object('starts_at', b.starts_at, 'blocked_until', b.blocked_until, 'resource_id', b.resource_id)), '[]'::jsonb)
    into v_busy from private.public_busy((v_cat -> 'business' ->> 'id')::uuid, v_from, v_to) b;
  return jsonb_build_object('rate', v_rate, 'catalog', v_cat, 'busy', v_busy);
end $$;

create function public.public_range(p_slug text, p_from date, p_days int, p_key text, p_window_seconds int, p_max int) returns jsonb
language sql security invoker set search_path = '' as $$ select private.public_range(p_slug, p_from, p_days, p_key, p_window_seconds, p_max) $$;

revoke all on function private.public_range(text, date, int, text, int, int), public.public_range(text, date, int, text, int, int) from public, anon, authenticated;
grant execute on function private.public_range(text, date, int, text, int, int), public.public_range(text, date, int, text, int, int) to service_role;
