-- Stage 13 / CAT-05: a service can be free, "from X", have a fixed price, or show no price at all.
alter table public.services add column price_mode text not null default 'fixed' check (price_mode in ('fixed','from','free','hidden'));
grant insert (price_mode), update (price_mode) on public.services to authenticated;
alter table public.services add constraint services_free_costs_nothing check (price_mode <> 'free' or price_cents = 0);

create or replace function private.public_catalog(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_slug text := private.normalize_slug(p_slug);
  b public.businesses;
  v_res uuid;
begin
  select * into b from public.businesses where lower(slug) = v_slug;
  if not found then
    select x.* into b from public.slug_redirects r join public.businesses x on x.id = r.business_id where r.old_slug = v_slug;
    if not found then return null; end if;
    if b.published_at is null then return null; end if;
    return jsonb_build_object('redirect', b.slug);          -- old link keeps working (ACC-07)
  end if;
  if b.published_at is null then return null; end if;      -- unknown and unpublished look identical (BKG-11, no enumeration)
  select id into v_res from public.resources where business_id = b.id and is_default;
  return jsonb_build_object(
    'business', jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'kind', b.kind, 'timezone', b.timezone, 'address', coalesce(b.address, ''),
      'requiresApproval', b.requires_approval, 'cancelUntilHours', b.cancel_until_hours, 'minNoticeMinutes', b.min_notice_minutes, 'horizonDays', b.booking_horizon_days, 'waitlistEnabled', b.waitlist_enabled and private.entitlement_can(b.id, 'waitlist'),
      'acceptingBookings', private.billing_accepts(b.id)),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', coalesce(s.description, ''), 'durationMinutes', s.duration_minutes,
        'bufferMinutes', s.buffer_minutes, 'priceCents', s.price_cents, 'priceMode', s.price_mode, 'requiresApproval', s.requires_approval) order by s.position, s.created_at)
        from public.services s where s.business_id = b.id and s.active and s.capacity = 1), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('weekday', r.weekday, 'startMinute', r.start_minute, 'endMinute', r.end_minute))
        from public.availability_rules r where r.business_id = b.id and r.resource_id = v_res), '[]'::jsonb),
    'exceptions', coalesce((select jsonb_agg(jsonb_build_object('date', e.on_date, 'kind', e.kind, 'startMinute', e.start_minute, 'endMinute', e.end_minute))
        from public.availability_exceptions e where e.business_id = b.id and e.resource_id = v_res and e.on_date >= (current_date - 2)), '[]'::jsonb)
  );
end $$;

create or replace function private.public_get_appointment(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'reference', a.reference, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at,
    'serviceName', a.service_snapshot->>'name', 'serviceId', a.service_id, 'priceMode', (select s.price_mode from public.services s where s.id = a.service_id), 'priceCents', a.price_cents, 'businessName', b.name, 'businessSlug', b.slug, 'timezone', b.timezone,
    'cancelUntil', a.starts_at - make_interval(hours => b.cancel_until_hours), 'updatedAt', a.updated_at, 'rescheduledCount', a.rescheduled_count)
  from public.appointments a join public.businesses b on b.id = a.business_id where a.id = p_id
$$;
