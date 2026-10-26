-- Migration 20261054000000_platform_admin_and_analytics.sql
-- 1. Platform Operator Authorization (platform_admins)
-- 2. Analytics Events Collection (analytics_events)
-- 3. Business Registration Outbox & Admin Notification (admin_business_registered)
-- 4. Secure Admin Metrics, Business Directory and Operational Error RPCs

-- ------------------------------------------------------------------ 1. Platform Admins Table
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.platform_admins add column if not exists email text;
alter table public.platform_admins add column if not exists notes text;

alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;

-- Platform admins can view their own authorization record
drop policy if exists platform_admins_select_own on public.platform_admins;
create policy platform_admins_select_own on public.platform_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.platform_admins to authenticated;

-- Seed known platform operator
insert into public.platform_admins (user_id, email, notes)
select id, email, 'Platform operator'
from auth.users
where lower(email) = 'yotam.fried@gmail.com'
on conflict (user_id) do update set email = excluded.email, notes = excluded.notes;

-- Core security check for platform operator access
create or replace function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.platform_admins pa
    join auth.users u on u.id = pa.user_id
    where pa.user_id = (select auth.uid())
      and u.email_confirmed_at is not null
  ) and private.second_factor_satisfied();
$$;

revoke all on function private.is_platform_admin() from public, anon, authenticated;
grant execute on function private.is_platform_admin() to authenticated, service_role;

create or replace function public.is_platform_admin() returns boolean
language sql stable security invoker set search_path = '' as $$
  select private.is_platform_admin();
$$;

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- ------------------------------------------------------------------ 2. Analytics Events Table
create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses (id) on delete cascade,
  event_type text not null check (event_type in (
    'business_registered',
    'onboarding_completed',
    'service_created',
    'booking_page_published',
    'booking_created',
    'booking_cancelled',
    'feature_used',
    'notification_failed'
  )),
  source text not null default 'server' check (source in ('server', 'ux')),
  actor_id uuid,
  dedupe_key text,
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 4096),
  created_at timestamptz not null default now()
);

alter table public.analytics_events enable row level security;
alter table public.analytics_events force row level security;

-- Foundation lint requirement: leading business_id index on tenant tables
create index if not exists analytics_events_business_idx on public.analytics_events (business_id, created_at desc);
create index if not exists analytics_events_type_created_idx on public.analytics_events (event_type, created_at desc);
create unique index if not exists analytics_events_dedupe_idx on public.analytics_events (business_id, event_type, dedupe_key) where dedupe_key is not null;
create unique index if not exists analytics_events_global_dedupe_idx on public.analytics_events (event_type, dedupe_key) where business_id is null and dedupe_key is not null;

drop policy if exists analytics_events_admin_select on public.analytics_events;
create policy analytics_events_admin_select on public.analytics_events
  for select to authenticated
  using (private.is_platform_admin());

grant select on public.analytics_events to authenticated;

create or replace function private.record_analytics_event(
  p_business uuid,
  p_type text,
  p_dedupe text default null,
  p_meta jsonb default '{}',
  p_source text default 'server'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.analytics_events (business_id, event_type, dedupe_key, meta, source, actor_id)
  values (p_business, p_type, p_dedupe, coalesce(p_meta, '{}'::jsonb), p_source, (select auth.uid()))
  on conflict do nothing
  returning id into v_id;
  return v_id;
end $$;

revoke all on function private.record_analytics_event(uuid, text, text, jsonb, text) from public, anon, authenticated;

-- Public RPC for tracking UX or authenticated feature usage
create or replace function public.track_feature_used(
  p_business uuid,
  p_feature text,
  p_dedupe text default null,
  p_meta jsonb default '{}'
) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null then return false; end if;
  if not (private.is_member(p_business, 'staff') or private.is_platform_admin()) then
    return false;
  end if;
  perform private.record_analytics_event(
    p_business,
    'feature_used',
    p_dedupe,
    jsonb_build_object('feature', p_feature) || coalesce(p_meta, '{}'::jsonb),
    'ux'
  );
  return true;
end $$;

revoke all on function public.track_feature_used(uuid, text, text, jsonb) from public, anon;
grant execute on function public.track_feature_used(uuid, text, text, jsonb) to authenticated;

-- ------------------------------------------------------------------ 3. Automatic Triggers for Core Events
-- A. Business Registered & Published
create or replace function private.trg_businesses_analytics() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.record_analytics_event(
      new.id,
      'business_registered',
      'biz:' || new.id::text,
      jsonb_build_object('kind', new.kind, 'slug', new.slug)
    );
    if new.published_at is not null then
      perform private.record_analytics_event(
        new.id,
        'booking_page_published',
        'pub:' || new.id::text,
        jsonb_build_object('publishedAt', new.published_at)
      );
      perform private.record_analytics_event(
        new.id,
        'onboarding_completed',
        'onb:' || new.id::text,
        jsonb_build_object('completedAt', new.published_at)
      );
    end if;
  elsif tg_op = 'UPDATE' then
    if old.published_at is null and new.published_at is not null then
      perform private.record_analytics_event(
        new.id,
        'booking_page_published',
        'pub:' || new.id::text,
        jsonb_build_object('publishedAt', new.published_at)
      );
      perform private.record_analytics_event(
        new.id,
        'onboarding_completed',
        'onb:' || new.id::text,
        jsonb_build_object('completedAt', new.published_at)
      );
    end if;
  end if;
  return new;
end $$;

revoke all on function private.trg_businesses_analytics() from public, anon, authenticated;

drop trigger if exists trg_businesses_analytics on public.businesses;
create trigger trg_businesses_analytics
  after insert or update on public.businesses
  for each row execute function private.trg_businesses_analytics();

-- B. Service Created
create or replace function private.trg_services_analytics() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.record_analytics_event(
    new.business_id,
    'service_created',
    'svc:' || new.id::text,
    jsonb_build_object('serviceId', new.id, 'durationMinutes', new.duration_minutes)
  );
  return new;
end $$;

revoke all on function private.trg_services_analytics() from public, anon, authenticated;

drop trigger if exists trg_services_analytics on public.services;
create trigger trg_services_analytics
  after insert on public.services
  for each row execute function private.trg_services_analytics();

-- C. Booking Created & Cancelled
create or replace function private.trg_appointments_analytics() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.record_analytics_event(
      new.business_id,
      'booking_created',
      'apt_created:' || new.id::text,
      jsonb_build_object('appointmentId', new.id, 'status', new.status, 'serviceId', new.service_id)
    );
  elsif tg_op = 'UPDATE' then
    if old.status not like 'cancelled%' and new.status like 'cancelled%' then
      perform private.record_analytics_event(
        new.business_id,
        'booking_cancelled',
        'apt_cancelled:' || new.id::text,
        jsonb_build_object('appointmentId', new.id, 'by', new.status, 'previousStatus', old.status)
      );
    end if;
  end if;
  return new;
end $$;

revoke all on function private.trg_appointments_analytics() from public, anon, authenticated;

drop trigger if exists trg_appointments_analytics on public.appointments;
create trigger trg_appointments_analytics
  after insert or update on public.appointments
  for each row execute function private.trg_appointments_analytics();

-- D. Notification Failure
create or replace function private.trg_notifications_analytics() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (old.status <> 'dead' and new.status = 'dead') or (old.bounced_at is null and new.bounced_at is not null) then
    perform private.record_analytics_event(
      new.business_id,
      'notification_failed',
      'notif_failed:' || new.id::text,
      jsonb_build_object('type', new.type, 'recipient', new.recipient, 'failureCode', new.failure_code)
    );
  end if;
  return new;
end $$;

revoke all on function private.trg_notifications_analytics() from public, anon, authenticated;

drop trigger if exists trg_notifications_analytics on public.notification_log;
create trigger trg_notifications_analytics
  after update on public.notification_log
  for each row execute function private.trg_notifications_analytics();

-- E. Feature Used Triggers (Waitlist & Multi-staff)
create or replace function private.trg_waitlist_analytics() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.record_analytics_event(
    new.business_id,
    'feature_used',
    'wl_entry:' || new.id::text,
    jsonb_build_object('feature', 'waitlist')
  );
  return new;
end $$;

revoke all on function private.trg_waitlist_analytics() from public, anon, authenticated;

drop trigger if exists trg_waitlist_analytics on public.waitlist_entries;
create trigger trg_waitlist_analytics
  after insert on public.waitlist_entries
  for each row execute function private.trg_waitlist_analytics();

create or replace function private.trg_resources_analytics() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.record_analytics_event(
    new.business_id,
    'feature_used',
    'resource:' || new.id::text,
    jsonb_build_object('feature', 'team_member')
  );
  return new;
end $$;

revoke all on function private.trg_resources_analytics() from public, anon, authenticated;

drop trigger if exists trg_resources_analytics on public.resources;
create trigger trg_resources_analytics
  after insert on public.resources
  for each row
  when (not new.is_default)
  execute function private.trg_resources_analytics();

-- ------------------------------------------------------------------ 4. Notification Log Extension for Admin Alert
alter table public.notification_log drop constraint if exists notification_log_recipient_check;
alter table public.notification_log add constraint notification_log_recipient_check check (recipient in ('customer', 'owner', 'admin'));

alter policy notification_select on public.notification_log
  using (
    (business_id in (select private.my_business_ids('staff')) and recipient <> 'admin')
    or private.is_platform_admin()
  );

alter table public.notification_log drop constraint if exists notification_log_type_check;
alter table public.notification_log add constraint notification_log_type_check check (type in (
  'booking_received','booking_confirmed','booking_declined','booking_cancelled_by_business','booking_cancelled_by_customer','reminder','owner_new_request','owner_customer_cancelled',
  'waitlist_offer','waitlist_offer_expired','booking_rescheduled','owner_customer_rescheduled','owner_unconfirmed','owner_digest','booking_moved_by_business',
  'owner_trial_ending','owner_trial_last_day','owner_payment_failed',
  'admin_business_registered'
));

create or replace function private.notif_enqueue_business_registered(p_business uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_date date;
begin
  select (created_at at time zone coalesce(timezone, 'Asia/Jerusalem'))::date into v_date
  from public.businesses where id = p_business;
  if v_date is null then return null; end if;

  insert into public.notification_log (business_id, type, recipient, digest_date)
  values (p_business, 'admin_business_registered', 'admin', v_date)
  on conflict (business_id, digest_date, type) where digest_date is not null do nothing
  returning id into v_id;

  return v_id;
end $$;

revoke all on function private.notif_enqueue_business_registered(uuid) from public, anon, authenticated;
grant execute on function private.notif_enqueue_business_registered(uuid) to service_role;

create or replace function public.notif_enqueue_business_registered(p_business uuid) returns uuid
language sql security invoker set search_path = '' as $$
  select private.notif_enqueue_business_registered(p_business);
$$;

revoke all on function public.notif_enqueue_business_registered(uuid) from public, anon, authenticated;
grant execute on function public.notif_enqueue_business_registered(uuid) to service_role;

-- Update private.notif_context to return registration details for admin_business_registered
create or replace function private.notif_context(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', n.id, 'type', n.type, 'recipient', n.recipient, 'attempts', n.attempts,
    'appointment', case when a.id is null then null else jsonb_build_object('id', a.id, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at, 'reference', a.reference,
                                      'serviceName', a.service_snapshot->>'name', 'location', a.location,
                                      'personName', (select r.name from public.resources r where r.id = a.resource_id and (select count(*) from public.resources x where x.business_id = b.id and x.active) >= 2)) end,
    'offer', case when o.id is null then null else jsonb_build_object('id', o.id, 'status', o.status, 'slotStartsAt', o.slot_starts_at, 'expiresAt', o.expires_at,
                                      'serviceName', sv.name, 'entryId', o.entry_id,
                                      'personName', (select r.name from public.resources r where r.id = o.resource_id and (select count(*) from public.resources x where x.business_id = b.id and x.active) >= 2)) end,
    'digest', case when n.type <> 'owner_digest' or n.digest_date is null then null else jsonb_build_object('date', n.digest_date,
        'cancelledYesterday', (select count(*) from public.appointments x where x.business_id = b.id and x.status like 'cancelled%' and (x.cancelled_at at time zone b.timezone)::date = n.digest_date - 1),
        'unmarked', (select count(*) from public.appointments x where x.business_id = b.id and x.status = 'confirmed' and x.ends_at < now()),
        'tomorrow', (select count(*) from public.appointments x where x.business_id = b.id and x.status in ('pending','confirmed') and (x.starts_at at time zone b.timezone)::date = n.digest_date + 1)) end,
    'billing', case when n.type not in ('owner_trial_ending','owner_trial_last_day','owner_payment_failed') then null
                    else (select jsonb_build_object('status', sub.status, 'trialEndsAt', sub.trial_ends_at, 'graceUntil', sub.grace_until) from public.subscriptions sub where sub.business_id = b.id) end,
    'registration', case when n.type <> 'admin_business_registered' then null
                         else jsonb_build_object('businessId', b.id, 'name', b.name, 'slug', b.slug, 'createdAt', b.created_at, 'publishedAt', b.published_at, 'kind', b.kind) end,
    'business', jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'kind', b.kind, 'timezone', b.timezone, 'phone', b.phone),
    'customer', jsonb_build_object('name', c.full_name, 'email', coalesce(a.contact_email, e.contact_email)),
    'owner', jsonb_build_object('email', (select u.email from public.business_members m join auth.users u on u.id = m.user_id
                                          where m.business_id = b.id and m.role = 'owner' order by m.created_at limit 1))
  )
  from public.notification_log n
  join public.businesses b on b.id = n.business_id
  left join public.appointments a on a.id = n.appointment_id
  left join public.waitlist_offers o on o.id = n.offer_id
  left join public.waitlist_entries e on e.id = o.entry_id
  left join public.services sv on sv.id = e.service_id
  left join public.customers c on c.id = coalesce(a.customer_id, e.customer_id)
  where n.id = p_id
$$;

-- ------------------------------------------------------------------ 5. Platform Admin Analytics & Directory RPCs
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
    'registrationsOverTime', v_over_time
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

-- Business directory query (privacy safe: returns business metadata and aggregate stats, never customer PII)
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
  waitlist_enabled boolean
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
    coalesce((b.settings->>'waitlist_enabled')::boolean, false) as waitlist_enabled
  from public.businesses b
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
  group by b.id
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
  waitlist_enabled boolean
) language sql security invoker set search_path = '' as $$
  select * from private.admin_list_businesses(p_search, p_status, p_from, p_to, p_limit, p_offset);
$$;

revoke all on function public.admin_list_businesses(text, text, timestamptz, timestamptz, int, int) from public, anon;
grant execute on function public.admin_list_businesses(text, text, timestamptz, timestamptz, int, int) to authenticated;

-- Operational error logs query (notification failures, failed events, job failures - zero customer PII)
create or replace function private.admin_system_errors(p_limit int default 50)
returns table (
  id text,
  category text,
  type text,
  error_message text,
  business_name text,
  created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    n.id::text,
    'notification'::text as category,
    n.type,
    coalesce(n.failure_code, n.error, 'failed') as error_message,
    b.name as business_name,
    n.created_at
  from public.notification_log n
  join public.businesses b on b.id = n.business_id
  where n.status in ('failed', 'dead') or n.failure_code is not null
  union all
  select
    e.id::text,
    'domain_event'::text as category,
    e.type,
    coalesce(e.last_error, 'unprocessed') as error_message,
    b.name as business_name,
    e.created_at
  from public.domain_events e
  join public.businesses b on b.id = e.business_id
  where e.last_error is not null
  union all
  select
    j.id::text,
    'job'::text as category,
    j.job_name as type,
    coalesce(j.error, 'failed') as error_message,
    'System'::text as business_name,
    j.started_at as created_at
  from public.job_runs j
  where j.status = 'failed'
  order by created_at desc
  limit greatest(p_limit, 1);
end $$;

revoke all on function private.admin_system_errors(int) from public, anon, authenticated;
grant execute on function private.admin_system_errors(int) to authenticated;

create or replace function public.admin_system_errors(p_limit int default 50)
returns table (
  id text,
  category text,
  type text,
  error_message text,
  business_name text,
  created_at timestamptz
) language sql security invoker set search_path = '' as $$
  select * from private.admin_system_errors(p_limit);
$$;

revoke all on function public.admin_system_errors(int) from public, anon;
grant execute on function public.admin_system_errors(int) to authenticated;

-- ------------------------------------------------------------------ 6. Backfill existing data into analytics_events
insert into public.analytics_events (business_id, event_type, dedupe_key, meta, source, created_at)
select b.id, 'business_registered', 'biz:' || b.id::text, jsonb_build_object('kind', b.kind, 'slug', b.slug), 'server', b.created_at
from public.businesses b
on conflict do nothing;

insert into public.analytics_events (business_id, event_type, dedupe_key, meta, source, created_at)
select b.id, 'booking_page_published', 'pub:' || b.id::text, jsonb_build_object('publishedAt', b.published_at), 'server', b.published_at
from public.businesses b
where b.published_at is not null
on conflict do nothing;

insert into public.analytics_events (business_id, event_type, dedupe_key, meta, source, created_at)
select b.id, 'onboarding_completed', 'onb:' || b.id::text, jsonb_build_object('completedAt', b.published_at), 'server', b.published_at
from public.businesses b
where b.published_at is not null
on conflict do nothing;

insert into public.analytics_events (business_id, event_type, dedupe_key, meta, source, created_at)
select s.business_id, 'service_created', 'svc:' || s.id::text, jsonb_build_object('serviceId', s.id, 'durationMinutes', s.duration_minutes), 'server', s.created_at
from public.services s
on conflict do nothing;

insert into public.analytics_events (business_id, event_type, dedupe_key, meta, source, created_at)
select a.business_id, 'booking_created', 'apt_created:' || a.id::text, jsonb_build_object('appointmentId', a.id, 'status', a.status, 'serviceId', a.service_id), 'server', a.created_at
from public.appointments a
on conflict do nothing;

insert into public.analytics_events (business_id, event_type, dedupe_key, meta, source, created_at)
select a.business_id, 'booking_cancelled', 'apt_cancelled:' || a.id::text, jsonb_build_object('appointmentId', a.id, 'by', a.status), 'server', coalesce(a.cancelled_at, a.updated_at)
from public.appointments a
where a.status like 'cancelled%'
on conflict do nothing;
