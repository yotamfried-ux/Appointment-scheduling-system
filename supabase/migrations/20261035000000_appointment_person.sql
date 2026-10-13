-- Stage 16: the customer's private page and the reschedule path need to know whose appointment it is (T6/T11).
-- The name is shown only when the business has two or more active people (teamSize); a one-person business shows nothing new.
create or replace function private.public_get_appointment(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'reference', a.reference, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at,
    'serviceName', a.service_snapshot->>'name', 'serviceId', a.service_id, 'priceMode', (select s.price_mode from public.services s where s.id = a.service_id), 'priceCents', a.price_cents,
    'businessName', b.name, 'businessSlug', b.slug, 'timezone', b.timezone,
    'cancelUntil', case when a.moved_by_business_at is not null then a.starts_at else a.starts_at - make_interval(hours => b.cancel_until_hours) end,
    'updatedAt', a.updated_at, 'rescheduledCount', a.rescheduled_count,
    'attendanceConfirmedAt', a.attendance_confirmed_at, 'serviceChangeAllowed', b.reschedule_service_change, 'movedByBusinessAt', a.moved_by_business_at,
    'resourceId', a.resource_id, 'resourceChosen', a.resource_chosen, 'personName', r.name,
    'teamSize', (select count(*) from public.resources x where x.business_id = a.business_id and x.active))
  from public.appointments a join public.businesses b on b.id = a.business_id join public.resources r on r.id = a.resource_id where a.id = p_id
$$;
