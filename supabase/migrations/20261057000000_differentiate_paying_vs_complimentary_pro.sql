-- Stage 26: Differentiate Paying Subscribers vs Complimentary PRO in Admin Metrics
-- Separates real paying SaaS customers from complimentary PRO accounts (e.g. Sivan Keinan, Platform Admin).
-- Ensures contractual MRR, ARR, and Net Profit strictly reflect actual revenue and cannot be inflated by free gifts.

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
  v_confirmed_bookings_in_period int;
  v_active_pct numeric;
  v_completed_pct numeric;
  v_growth_pct numeric;
  v_funnel_registered int;
  v_funnel_services int;
  v_funnel_published int;
  v_funnel_first_booking int;
  v_over_time jsonb;

  -- Financial & Revenue variables
  v_paying_subs int;
  v_paying_mrr_nis numeric;
  v_complimentary_subs int;
  v_complimentary_value_nis numeric;
  v_contractual_mrr_nis numeric;
  v_collected_revenue_nis numeric := 0;
  v_trialing_subs int;
  v_trial_potential_mrr_nis numeric;
  v_past_due_subs int;

  -- Booking Value Cohorts
  v_total_appointments_count int;
  v_total_booking_value_nis numeric;
  v_avg_total_booking_value_nis numeric;

  v_confirmed_bookings_count int;
  v_confirmed_booking_value_nis numeric;
  v_avg_confirmed_booking_value_nis numeric;

  v_completed_bookings_count int;
  v_completed_services_value_nis numeric;
  v_avg_completed_service_value_nis numeric;

  v_period_confirmed_value_nis numeric;
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
  select count(*) into v_confirmed_bookings_in_period from public.appointments where created_at between v_from and v_to and status in ('confirmed', 'completed');

  v_completed_pct := case when v_cur_bookings > 0 then round((v_confirmed_bookings_in_period::numeric / v_cur_bookings::numeric) * 100, 1) else 100.0 end;
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

  -- 1. SaaS Subscriptions: Differentiate Paying vs Complimentary PRO
  -- Real paying active subscribers
  select count(*), coalesce(sum(p.price_cents) / 100, 0)
  into v_paying_subs, v_paying_mrr_nis
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.status = 'active'
    and coalesce(s.provider, '') != 'manual'
    and s.current_period_end is not null
    and not exists (
      select 1 from public.business_members bm
      join auth.users u on u.id = bm.user_id
      where bm.business_id = s.business_id
        and bm.role = 'owner'
        and private.is_whitelisted_pro_email(u.email)
    )
    and not exists (
      select 1 from public.entitlement_overrides eo
      where eo.business_id = s.business_id
        and eo.reason = 'חשבון PRO ללא הגבלה'
    );

  -- Complimentary / Gifted PRO subscribers (Admin, Sivan, and manual grants)
  select count(*), coalesce(sum(p.price_cents) / 100, 0)
  into v_complimentary_subs, v_complimentary_value_nis
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.status = 'active'
    and (
      s.provider = 'manual'
      or s.current_period_end is null
      or exists (
        select 1 from public.business_members bm
        join auth.users u on u.id = bm.user_id
        where bm.business_id = s.business_id
          and bm.role = 'owner'
          and private.is_whitelisted_pro_email(u.email)
      )
      or exists (
        select 1 from public.entitlement_overrides eo
        where eo.business_id = s.business_id
          and eo.reason = 'חשבון PRO ללא הגבלה'
      )
    );

  -- Contractual MRR strictly represents real paying customers
  v_contractual_mrr_nis := v_paying_mrr_nis;

  select count(*) into v_trialing_subs from public.subscriptions where status = 'trialing';
  select count(*) into v_past_due_subs from public.subscriptions where status in ('past_due', 'canceled');

  select coalesce(sum(p.price_cents) / 100, 0)
  into v_trial_potential_mrr_nis
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.status = 'trialing';

  -- 2. Booking Values Across Explicit Cohorts
  select count(*), coalesce(sum(price_cents) / 100, 0)
  into v_total_appointments_count, v_total_booking_value_nis
  from public.appointments;

  v_avg_total_booking_value_nis := case when v_total_appointments_count > 0 
    then round((v_total_booking_value_nis::numeric / v_total_appointments_count::numeric), 1) 
    else 0 end;

  select count(*), coalesce(sum(price_cents) / 100, 0)
  into v_confirmed_bookings_count, v_confirmed_booking_value_nis
  from public.appointments
  where status in ('confirmed', 'completed');

  v_avg_confirmed_booking_value_nis := case when v_confirmed_bookings_count > 0 
    then round((v_confirmed_booking_value_nis::numeric / v_confirmed_bookings_count::numeric), 1) 
    else 0 end;

  select count(*), coalesce(sum(price_cents) / 100, 0)
  into v_completed_bookings_count, v_completed_services_value_nis
  from public.appointments
  where status = 'completed';

  v_avg_completed_service_value_nis := case when v_completed_bookings_count > 0 
    then round((v_completed_services_value_nis::numeric / v_completed_bookings_count::numeric), 1) 
    else 0 end;

  select coalesce(sum(price_cents) / 100, 0)
  into v_period_confirmed_value_nis
  from public.appointments
  where created_at between v_from and v_to
    and status in ('confirmed', 'completed');

  -- 3. Plan breakdown with paying vs complimentary separation
  select coalesce(jsonb_agg(jsonb_build_object(
    'planId', p.id,
    'planName', p.name,
    'priceNis', p.price_cents / 100,
    'subscribers', coalesce(sub_counts.cnt, 0),
    'payingSubscribers', coalesce(sub_counts.paying_cnt, 0),
    'complimentarySubscribers', coalesce(sub_counts.complimentary_cnt, 0),
    'revenueNis', coalesce(sub_counts.paying_cnt, 0) * (p.price_cents / 100)
  ) order by p.position), '[]'::jsonb)
  into v_plan_breakdown
  from public.plans p
  left join (
    select
      s.plan_id,
      count(*) as cnt,
      count(*) filter (where
        coalesce(s.provider, '') != 'manual'
        and s.current_period_end is not null
        and not exists (
          select 1 from public.business_members bm
          join auth.users u on u.id = bm.user_id
          where bm.business_id = s.business_id and bm.role = 'owner' and private.is_whitelisted_pro_email(u.email)
        )
        and not exists (
          select 1 from public.entitlement_overrides eo
          where eo.business_id = s.business_id and eo.reason = 'חשבון PRO ללא הגבלה'
        )
      ) as paying_cnt,
      count(*) filter (where
        s.provider = 'manual'
        or s.current_period_end is null
        or exists (
          select 1 from public.business_members bm
          join auth.users u on u.id = bm.user_id
          where bm.business_id = s.business_id and bm.role = 'owner' and private.is_whitelisted_pro_email(u.email)
        )
        or exists (
          select 1 from public.entitlement_overrides eo
          where eo.business_id = s.business_id and eo.reason = 'חשבון PRO ללא הגבלה'
        )
      ) as complimentary_cnt
    from public.subscriptions s
    where s.status = 'active'
    group by s.plan_id
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
      -- SaaS Platform Revenue - Separated
      'contractualMrrNis', v_contractual_mrr_nis,
      'payingMrrNis', v_paying_mrr_nis,
      'collectedRevenueNis', v_collected_revenue_nis,
      'arrNis', v_contractual_mrr_nis * 12,
      'activeSubscribers', v_paying_subs,
      'payingSubscribers', v_paying_subs,
      'complimentarySubscribers', v_complimentary_subs,
      'complimentaryValueNis', v_complimentary_value_nis,
      'totalActiveProSubscribers', v_paying_subs + v_complimentary_subs,
      'trialingSubscribers', v_trialing_subs,
      'trialPotentialMrrNis', v_trial_potential_mrr_nis,
      'pastDueSubscribers', v_past_due_subs,
      -- Booking Values
      'confirmedBookingValueNis', v_confirmed_booking_value_nis,
      'confirmedBookingsCount', v_confirmed_bookings_count,
      'avgConfirmedBookingValueNis', v_avg_confirmed_booking_value_nis,
      'completedServicesValueNis', v_completed_services_value_nis,
      'completedBookingsCount', v_completed_bookings_count,
      'avgCompletedServiceValueNis', v_avg_completed_service_value_nis,
      'totalAppointmentsCount', v_total_appointments_count,
      'totalBookingValueNis', v_total_booking_value_nis,
      'avgTotalBookingValueNis', v_avg_total_booking_value_nis,
      'periodConfirmedBookingValueNis', v_period_confirmed_value_nis,
      'periodConfirmedBookingsCount', v_confirmed_bookings_in_period,
      -- Backwards compatibility aliases
      'mrrNis', v_contractual_mrr_nis,
      'totalGmvNis', v_total_booking_value_nis,
      'periodGmvNis', v_period_confirmed_value_nis,
      'averageBookingValueNis', v_avg_confirmed_booking_value_nis,
      'plans', v_plan_breakdown
    )
  );
end $$;

revoke all on function private.admin_dashboard_metrics(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function private.admin_dashboard_metrics(timestamptz, timestamptz) to authenticated;

create or replace function public.admin_dashboard_metrics(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.admin_dashboard_metrics(p_from, p_to);
$$;

revoke all on function public.admin_dashboard_metrics(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_dashboard_metrics(timestamptz, timestamptz) to authenticated;

-- Update admin_list_businesses to return subscription tier & type
drop function if exists public.admin_list_businesses(text, text, timestamptz, timestamptz, int, int);
drop function if exists private.admin_list_businesses(text, text, timestamptz, timestamptz, int, int);

create or replace function private.admin_list_businesses(
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
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    b.id,
    b.name,
    b.slug,
    b.kind,
    b.phone,
    b.published_at,
    b.created_at,
    (select u.email::text from public.business_members bm join auth.users u on u.id = bm.user_id where bm.business_id = b.id and bm.role = 'owner' order by bm.created_at limit 1) as owner_email,
    count(a.id) as total_appointments,
    count(a.id) filter (where a.status like 'cancelled%') as cancelled_appointments,
    case when count(a.id) > 0 then round((count(a.id) filter (where a.status like 'cancelled%')::numeric / count(a.id)::numeric) * 100, 1) else 0.0 end as cancellation_rate,
    (select count(*) from public.services s where s.business_id = b.id) as services_count,
    (select count(*) from public.resources r where r.business_id = b.id and r.active) as staff_count,
    coalesce((b.settings->>'waitlist_enabled')::boolean, false) as waitlist_enabled,
    coalesce(sub.plan_id, 'free') as subscription_tier,
    case
      when sub.status = 'trialing' then 'trial'
      when sub.status = 'active' and (
        sub.provider = 'manual'
        or sub.current_period_end is null
        or exists (
          select 1 from public.business_members bm
          join auth.users u on u.id = bm.user_id
          where bm.business_id = b.id and bm.role = 'owner' and private.is_whitelisted_pro_email(u.email)
        )
        or exists (
          select 1 from public.entitlement_overrides eo
          where eo.business_id = b.id and eo.reason = 'חשבון PRO ללא הגבלה'
        )
      ) then 'complimentary'
      when sub.status = 'active' then 'paying'
      when sub.status in ('past_due', 'canceled') then 'canceled'
      else 'free'
    end as subscription_type
  from public.businesses b
  left join public.subscriptions sub on sub.business_id = b.id
  left join public.appointments a on a.business_id = b.id
    and (p_from is null or a.created_at >= p_from)
    and (p_to is null or a.created_at <= p_to)
  where
    (p_search is null or b.name ilike '%' || btrim(p_search) || '%' or b.slug ilike '%' || btrim(p_search) || '%')
    and (
      p_status is null
      or (p_status = 'active' and b.published_at is not null)
      or (p_status = 'draft' and b.published_at is null)
    )
    and (p_from is null or b.created_at >= p_from)
    and (p_to is null or b.created_at <= p_to)
  group by b.id, sub.plan_id, sub.status, sub.provider, sub.current_period_end
  order by b.created_at desc
  limit greatest(p_limit, 1) offset greatest(p_offset, 0);
end $$;

revoke all on function private.admin_list_businesses(text, text, timestamptz, timestamptz, int, int) from public, anon, authenticated;
grant execute on function private.admin_list_businesses(text, text, timestamptz, timestamptz, int, int) to authenticated;

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
