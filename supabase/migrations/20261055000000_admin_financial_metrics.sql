-- Stage 24: Platform Admin Financial & SaaS Revenue Metrics
-- Extends private.admin_dashboard_metrics with:
-- 1. SaaS Platform Revenue: MRR, ARR, active subscribers, trialing businesses, and plan-level breakdown
-- 2. System GMV: Gross booking merchandise value (completed appointments value) and average ticket value
-- Protected strictly behind private.is_platform_admin() (raising 42501 for unauthorized callers)

create or replace function private.admin_dashboard_metrics(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_prev_from timestamptz;
  v_total_businesses int;
  v_new_businesses int;
  v_active_businesses int;
  v_prev_bookings int;
  v_cur_bookings int;
  v_completed_bookings int;
  v_active_pct numeric;
  v_completed_pct numeric;
  v_growth_pct numeric;
  v_funnel_registered int;
  v_funnel_services int;
  v_funnel_published int;
  v_funnel_first_booking int;
  v_over_time jsonb;

  -- Financial & Revenue variables
  v_mrr_nis numeric;
  v_active_subs int;
  v_trialing_subs int;
  v_past_due_subs int;
  v_total_gmv_nis numeric;
  v_period_gmv_nis numeric;
  v_avg_booking_val numeric;
  v_plan_breakdown jsonb;
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_prev_from := v_from - (v_to - v_from);

  select count(*) into v_total_businesses from public.businesses;
  select count(*) into v_new_businesses from public.businesses where created_at between v_from and v_to;
  select count(*) into v_active_businesses from public.businesses where published_at is not null;

  v_active_pct := case when v_total_businesses > 0 then round((v_active_businesses::numeric / v_total_businesses::numeric) * 100, 1) else 0 end;

  select count(*) into v_cur_bookings from public.appointments where created_at between v_from and v_to;
  select count(*) into v_prev_bookings from public.appointments where created_at between v_prev_from and v_from;
  select count(*) into v_completed_bookings from public.appointments where created_at between v_from and v_to and status in ('confirmed', 'completed');

  v_completed_pct := case when v_cur_bookings > 0 then round((v_completed_bookings::numeric / v_cur_bookings::numeric) * 100, 1) else 100.0 end;
  v_growth_pct := case when v_prev_bookings > 0 then round(((v_cur_bookings - v_prev_bookings)::numeric / v_prev_bookings::numeric) * 100, 1) else 0.0 end;

  -- Activation Funnel
  v_funnel_registered := v_total_businesses;
  select count(distinct business_id) into v_funnel_services from public.services;
  v_funnel_published := v_active_businesses;
  select count(distinct business_id) into v_funnel_first_booking from public.appointments;

  -- Registrations over time (last 6 weeks)
  select coalesce(jsonb_agg(jsonb_build_object(
    'period', to_char(date_trunc('week', d), 'DD/MM'),
    'count', (select count(*) from public.businesses b where b.created_at >= d and b.created_at < d + interval '1 week')
  ) order by d), '[]'::jsonb)
  into v_over_time
  from generate_series(date_trunc('week', now() - interval '5 weeks'), date_trunc('week', now()), interval '1 week') as d;

  -- Financial Metrics
  -- 1. SaaS Subscriptions & Platform Revenue
  select coalesce(sum(p.price_cents) / 100, 0)
  into v_mrr_nis
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.status = 'active';

  select count(*) into v_active_subs from public.subscriptions where status = 'active';
  select count(*) into v_trialing_subs from public.subscriptions where status = 'trialing';
  select count(*) into v_past_due_subs from public.subscriptions where status in ('past_due', 'canceled');

  -- 2. System GMV & Bookings Value
  select coalesce(sum(price_cents) / 100, 0)
  into v_total_gmv_nis
  from public.appointments
  where status in ('confirmed', 'completed');

  select coalesce(sum(price_cents) / 100, 0)
  into v_period_gmv_nis
  from public.appointments
  where created_at between v_from and v_to
    and status in ('confirmed', 'completed');

  v_avg_booking_val := case when v_completed_bookings > 0 then round((v_period_gmv_nis::numeric / v_completed_bookings::numeric), 1) else 0 end;

  -- 3. Plan breakdown
  select coalesce(jsonb_agg(jsonb_build_object(
    'planId', p.id,
    'planName', p.name,
    'priceNis', p.price_cents / 100,
    'subscribers', coalesce(sub_counts.cnt, 0),
    'revenueNis', coalesce(sub_counts.cnt, 0) * (p.price_cents / 100)
  ) order by p.position), '[]'::jsonb)
  into v_plan_breakdown
  from public.plans p
  left join (
    select plan_id, count(*) as cnt
    from public.subscriptions
    where status = 'active'
    group by plan_id
  ) sub_counts on sub_counts.plan_id = p.id
  where p.active = true;

  return jsonb_build_object(
    'totalBusinesses', v_total_businesses,
    'newBusinesses', v_new_businesses,
    'activeBusinesses', v_active_businesses,
    'activePercentage', v_active_pct,
    'bookingsInPeriod', v_cur_bookings,
    'bookingsGrowth', v_growth_pct,
    'completedPercentage', v_completed_pct,
    'funnel', jsonb_build_object(
      'registered', v_funnel_registered,
      'serviceCreated', v_funnel_services,
      'servicePercentage', case when v_funnel_registered > 0 then round((v_funnel_services::numeric / v_funnel_registered::numeric) * 100, 1) else 0 end,
      'pagePublished', v_funnel_published,
      'publishedPercentage', case when v_funnel_registered > 0 then round((v_funnel_published::numeric / v_funnel_registered::numeric) * 100, 1) else 0 end,
      'firstBooking', v_funnel_first_booking,
      'firstBookingPercentage', case when v_funnel_registered > 0 then round((v_funnel_first_booking::numeric / v_funnel_registered::numeric) * 100, 1) else 0 end
    ),
    'registrationsOverTime', v_over_time,
    'financial', jsonb_build_object(
      'mrrNis', v_mrr_nis,
      'arrNis', v_mrr_nis * 12,
      'activeSubscribers', v_active_subs,
      'trialingSubscribers', v_trialing_subs,
      'pastDueSubscribers', v_past_due_subs,
      'totalGmvNis', v_total_gmv_nis,
      'periodGmvNis', v_period_gmv_nis,
      'averageBookingValueNis', v_avg_booking_val,
      'plans', v_plan_breakdown
    )
  );
end $$;

revoke all on function private.admin_dashboard_metrics(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function private.admin_dashboard_metrics(timestamptz, timestamptz) to authenticated;

create or replace function public.admin_dashboard_metrics(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.admin_dashboard_metrics(p_from, p_to);
$$;

revoke all on function public.admin_dashboard_metrics(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_dashboard_metrics(timestamptz, timestamptz) to authenticated;
