-- Stage 13: attendance confirmation (NSH-01), an alert to the owner about unconfirmed visits (NSH-02), overdue visits reminded or closed automatically (NSH-06),
-- a daily owner digest that is never empty and never sent at night (NTF-11, NTF-09).
alter table public.appointments add column attendance_confirmed_at timestamptz;
alter table public.businesses
  add column attendance_alert_minutes int not null default 0 check (attendance_alert_minutes between 0 and 1440),       -- 0 = off (opt-in: nobody gets a new kind of mail they did not ask for)
  add column auto_complete_hours int check (auto_complete_hours is null or auto_complete_hours between 1 and 168),      -- null = never close visits by itself
  add column digest_frequency text not null default 'off' check (digest_frequency in ('off','daily'));
grant update (attendance_alert_minutes, auto_complete_hours, digest_frequency) on public.businesses to authenticated;

alter table public.notification_log add column digest_date date;
alter table public.notification_log drop constraint notification_log_type_check;
alter table public.notification_log add constraint notification_log_type_check check (type in
  ('booking_received','booking_confirmed','booking_declined','booking_cancelled_by_business','booking_cancelled_by_customer','reminder','owner_new_request','owner_customer_cancelled',
   'waitlist_offer','waitlist_offer_expired','booking_rescheduled','owner_customer_rescheduled','owner_unconfirmed','owner_digest'));
alter table public.notification_log drop constraint notification_target;
alter table public.notification_log add constraint notification_target check (num_nonnulls(appointment_id, offer_id, digest_date) = 1);
create unique index notification_digest_key on public.notification_log (business_id, digest_date, type) where digest_date is not null;

create or replace function private.notif_context(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', n.id, 'type', n.type, 'recipient', n.recipient, 'attempts', n.attempts,
    'appointment', case when a.id is null then null else jsonb_build_object('id', a.id, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at, 'reference', a.reference,
                                      'serviceName', a.service_snapshot->>'name', 'location', a.location) end,
    'offer', case when o.id is null then null else jsonb_build_object('id', o.id, 'status', o.status, 'slotStartsAt', o.slot_starts_at, 'expiresAt', o.expires_at,
                                      'serviceName', sv.name, 'entryId', o.entry_id) end,
    'digest', case when n.digest_date is null then null else jsonb_build_object('date', n.digest_date,
        'cancelledYesterday', (select count(*) from public.appointments x where x.business_id = b.id and x.status like 'cancelled%' and (x.cancelled_at at time zone b.timezone)::date = n.digest_date - 1),
        'unmarked', (select count(*) from public.appointments x where x.business_id = b.id and x.status = 'confirmed' and x.ends_at < now()),
        'tomorrow', (select count(*) from public.appointments x where x.business_id = b.id and x.status in ('pending','confirmed') and (x.starts_at at time zone b.timezone)::date = n.digest_date + 1)) end,
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

-- NSH-01: the customer says "I am coming". Never changes the status; asking twice changes nothing.
create function private.public_confirm_attendance(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.appointments;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if a.status not in ('pending', 'confirmed') or a.ends_at < now() then return jsonb_build_object('outcome', 'not_active'); end if;
  if a.attendance_confirmed_at is not null then return jsonb_build_object('outcome', 'already', 'at', a.attendance_confirmed_at); end if;
  update public.appointments set attendance_confirmed_at = now() where id = p_id;
  return jsonb_build_object('outcome', 'confirmed', 'at', now());
end $$;

-- NSH-02: one alert per appointment, N minutes before it starts, only when the customer has not confirmed and the owner has not switched the alert off
create function private.enqueue_attendance_alerts(p_now timestamptz default now()) returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  with ins as (
    insert into public.notification_log (business_id, appointment_id, type, recipient)
    select a.business_id, a.id, 'owner_unconfirmed', 'owner'
    from public.appointments a join public.businesses b on b.id = a.business_id
    where b.attendance_alert_minutes > 0 and b.deletion_requested_at is null
      and a.status = 'confirmed' and a.attendance_confirmed_at is null
      and a.starts_at > p_now and a.starts_at <= p_now + make_interval(mins => b.attendance_alert_minutes)
      and a.created_at <= a.starts_at - make_interval(mins => b.attendance_alert_minutes)         -- booked inside the window = the customer just chose this time
    on conflict (appointment_id, type) do nothing returning 1)
  select count(*) into v_n from ins;
  return v_n;
end $$;

-- NSH-06: visits the owner never closed are completed by themselves after N hours, when the business chose that (never a no-show: that is the owner's judgement)
create function private.auto_complete_past(p_now timestamptz default now()) returns int language plpgsql security definer set search_path = '' as $$
declare v_n int := 0; b record; v_c int;
begin
  for b in select id, auto_complete_hours from public.businesses where auto_complete_hours is not null and deletion_requested_at is null loop
    update public.appointments set status = 'completed' where business_id = b.id and status = 'confirmed' and ends_at < p_now - make_interval(hours => b.auto_complete_hours);
    get diagnostics v_c = row_count;
    if v_c > 0 then
      perform private.audit_write(b.id, 'appointments.auto_completed', 'business', b.id::text, jsonb_build_object('count', v_c, 'afterHours', b.auto_complete_hours));
      v_n := v_n + v_c;
    end if;
  end loop;
  return v_n;
end $$;

-- NTF-11 / NTF-09: a daily digest per business, only between 07:00 and 21:00 local time, once per local day, and only when there is something to say
create function private.enqueue_digests(p_now timestamptz default now()) returns int language plpgsql security definer set search_path = '' as $$
declare b record; v_local timestamp; v_date date; v_n int := 0; v_cancel int; v_unmarked int; v_tomorrow int;
begin
  for b in select id, timezone from public.businesses where digest_frequency = 'daily' and published_at is not null and deletion_requested_at is null loop
    v_local := p_now at time zone b.timezone; v_date := v_local::date;
    continue when extract(hour from v_local) < 7 or extract(hour from v_local) >= 21;
    select count(*) into v_cancel from public.appointments x where x.business_id = b.id and x.status like 'cancelled%' and (x.cancelled_at at time zone b.timezone)::date = v_date - 1;
    select count(*) into v_unmarked from public.appointments x where x.business_id = b.id and x.status = 'confirmed' and x.ends_at < p_now;
    select count(*) into v_tomorrow from public.appointments x where x.business_id = b.id and x.status in ('pending','confirmed') and (x.starts_at at time zone b.timezone)::date = v_date + 1;
    continue when v_cancel + v_unmarked + v_tomorrow = 0;                                    -- never an empty digest
    insert into public.notification_log (business_id, type, recipient, digest_date) values (b.id, 'owner_digest', 'owner', v_date) on conflict (business_id, digest_date, type) where digest_date is not null do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

create function public.public_confirm_attendance(p_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.public_confirm_attendance(p_id) $$;
create function public.owner_housekeeping(p_now timestamptz default now()) returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('alerts', private.enqueue_attendance_alerts(p_now), 'autoCompleted', private.auto_complete_past(p_now), 'digests', private.enqueue_digests(p_now))
$$;
revoke all on function private.public_confirm_attendance(uuid), private.enqueue_attendance_alerts(timestamptz), private.auto_complete_past(timestamptz), private.enqueue_digests(timestamptz),
  public.public_confirm_attendance(uuid), public.owner_housekeeping(timestamptz) from public, anon, authenticated;
grant execute on function private.public_confirm_attendance(uuid), private.enqueue_attendance_alerts(timestamptz), private.auto_complete_past(timestamptz), private.enqueue_digests(timestamptz),
  public.public_confirm_attendance(uuid), public.owner_housekeeping(timestamptz) to service_role;

-- the customer's private page also shows whether attendance was confirmed
create or replace function private.public_get_appointment(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'reference', a.reference, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at,
    'serviceName', a.service_snapshot->>'name', 'serviceId', a.service_id, 'priceMode', (select s.price_mode from public.services s where s.id = a.service_id), 'priceCents', a.price_cents,
    'businessName', b.name, 'businessSlug', b.slug, 'timezone', b.timezone,
    'cancelUntil', a.starts_at - make_interval(hours => b.cancel_until_hours), 'updatedAt', a.updated_at, 'rescheduledCount', a.rescheduled_count,
    'attendanceConfirmedAt', a.attendance_confirmed_at)
  from public.appointments a join public.businesses b on b.id = a.business_id where a.id = p_id
$$;
