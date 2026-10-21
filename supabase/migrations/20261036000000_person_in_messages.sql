-- Stage 16 / T11: the person's name goes into the customer's mail and the waitlist page, only in a business with two or more active people.
-- (A one-person business gets exactly the same messages as before.)
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
    'business', jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'kind', b.kind, 'timezone', b.timezone, 'phone', b.phone),
    'customer', jsonb_build_object('name', c.full_name, 'email', coalesce(a.contact_email, e.contact_email)),   -- never the customer row: that is not proof of whose address it is
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

create or replace function private.waitlist_view(p_entry uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'status', e.status, 'onDate', e.on_date, 'fromMinute', e.from_minute, 'toMinute', e.to_minute,
    'serviceName', s.name, 'businessName', b.name, 'businessSlug', b.slug, 'timezone', b.timezone,
    'offer', (select jsonb_build_object('id', o.id, 'slotStartsAt', o.slot_starts_at, 'slotEndsAt', o.slot_ends_at, 'expiresAt', o.expires_at,
                                       'personName', (select r.name from public.resources r where r.id = o.resource_id and (select count(*) from public.resources x where x.business_id = e.business_id and x.active) >= 2))
              from public.waitlist_offers o where o.entry_id = e.id and o.status = 'pending' and o.expires_at > now() order by o.created_at desc limit 1),
    'booking', (select jsonb_build_object('startsAt', a.starts_at, 'reference', a.reference, 'status', a.status)
                from public.waitlist_offers o join public.appointments a on a.id = o.appointment_id where o.entry_id = e.id and o.status = 'accepted' order by o.resolved_at desc limit 1))
  from public.waitlist_entries e join public.services s on s.id = e.service_id join public.businesses b on b.id = e.business_id
  where e.id = p_entry
$$;
