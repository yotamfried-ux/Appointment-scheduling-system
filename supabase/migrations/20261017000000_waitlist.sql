-- Stage 7: waitlist (docs/04 WLT-01..08). Offers are decided in SQL, in the same transaction that frees the slot.

alter table public.businesses
  add column waitlist_enabled boolean not null default true,
  add column waitlist_auto_offer boolean not null default true,          -- WLT-06: off = the owner offers manually
  add column waitlist_offer_minutes int not null default 30 check (waitlist_offer_minutes between 5 and 1440);
grant update (waitlist_enabled, waitlist_auto_offer, waitlist_offer_minutes) on public.businesses to authenticated;

create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  service_id uuid not null references public.services (id),
  customer_id uuid not null references public.customers (id),
  on_date date not null,                                -- the local day (business time zone) the customer wants
  from_minute int,                                      -- optional window inside that day, minutes from local midnight
  to_minute int,
  status text not null default 'waiting' check (status in ('waiting','offered','booked','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((from_minute is null) = (to_minute is null)),
  check (from_minute is null or (from_minute >= 0 and to_minute <= 1440 and from_minute < to_minute))
);
create unique index waitlist_one_active on public.waitlist_entries (business_id, customer_id, service_id, on_date) where status in ('waiting','offered');
create index waitlist_fifo on public.waitlist_entries (business_id, on_date, created_at) where status = 'waiting';
create trigger waitlist_entries_touch before update on public.waitlist_entries for each row execute function private.touch_updated_at();

create table public.waitlist_offers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  entry_id uuid not null references public.waitlist_entries (id) on delete cascade,
  slot_starts_at timestamptz not null,
  slot_ends_at timestamptz not null,                    -- start + the entry's service duration
  blocked_until timestamptz not null,                   -- + buffer: what the offer reserves
  freed_until timestamptz not null,                     -- the extent of the slot that was freed (so the next person can be offered the same hole)
  status text not null default 'pending' check (status in ('pending','accepted','declined','expired','lost')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  appointment_id uuid references public.appointments (id),
  check (slot_starts_at < slot_ends_at and slot_ends_at <= blocked_until and blocked_until <= freed_until),
  unique (entry_id, slot_starts_at),                    -- the same slot is never offered to the same person twice
  -- one live offer per stretch of time (WLT-01: sequential FIFO)
  exclude using gist (business_id with =, tstzrange(slot_starts_at, blocked_until, '[)') with &&) where (status = 'pending')
);
create index waitlist_offers_pending_idx on public.waitlist_offers (expires_at) where status = 'pending';

alter table public.waitlist_entries enable row level security;  alter table public.waitlist_entries force row level security;
alter table public.waitlist_offers enable row level security;   alter table public.waitlist_offers force row level security;
create policy waitlist_entries_select on public.waitlist_entries for select to authenticated using (private.is_member(business_id, 'staff'));
create policy waitlist_offers_select on public.waitlist_offers for select to authenticated using (private.is_member(business_id, 'staff'));
grant select on public.waitlist_entries, public.waitlist_offers to authenticated;
grant select on public.waitlist_entries, public.waitlist_offers to service_role;

-- Tenant smuggling guard + immutability (only the status moves).
create function private.waitlist_entries_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.services s where s.id = new.service_id and s.business_id = new.business_id)
       or not exists (select 1 from public.customers c where c.id = new.customer_id and c.business_id = new.business_id) then
      raise exception 'tenant_mismatch' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.business_id <> old.business_id or new.service_id <> old.service_id or new.customer_id <> old.customer_id or new.on_date <> old.on_date
     or new.from_minute is distinct from old.from_minute or new.to_minute is distinct from old.to_minute then
    raise exception 'waitlist_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger waitlist_entries_guard before insert or update on public.waitlist_entries for each row execute function private.waitlist_entries_guard();

-- ------------------------------------------------------------------ notifications also target offers
alter table public.notification_log
  alter column appointment_id drop not null,
  add column offer_id uuid references public.waitlist_offers (id) on delete cascade;
alter table public.notification_log drop constraint notification_log_type_check;
alter table public.notification_log add constraint notification_log_type_check check (type in
  ('booking_received','booking_confirmed','booking_declined','booking_cancelled_by_business','booking_cancelled_by_customer','reminder','owner_new_request','owner_customer_cancelled',
   'waitlist_offer','waitlist_offer_expired'));
alter table public.notification_log add constraint notification_target check ((appointment_id is not null) <> (offer_id is not null));
create unique index notification_offer_type_key on public.notification_log (offer_id, type) where offer_id is not null;

create function private.notif_enqueue_offer(p_offer uuid, p_type text) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_business uuid;
begin
  select business_id into v_business from public.waitlist_offers where id = p_offer;
  if v_business is null then return null; end if;
  insert into public.notification_log (business_id, offer_id, type, recipient) values (v_business, p_offer, p_type, 'customer')
  on conflict (offer_id, type) where offer_id is not null do nothing returning id into v_id;
  return v_id;
end $$;

create or replace function private.notif_context(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', n.id, 'type', n.type, 'recipient', n.recipient, 'attempts', n.attempts,
    'appointment', case when a.id is null then null else jsonb_build_object('id', a.id, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at, 'reference', a.reference,
                                      'serviceName', a.service_snapshot->>'name', 'location', a.location) end,
    'offer', case when o.id is null then null else jsonb_build_object('id', o.id, 'status', o.status, 'slotStartsAt', o.slot_starts_at, 'expiresAt', o.expires_at,
                                      'serviceName', sv.name, 'entryId', o.entry_id) end,
    'business', jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'kind', b.kind, 'timezone', b.timezone, 'phone', b.phone),
    'customer', jsonb_build_object('name', c.full_name, 'email', c.email),
    'owner', jsonb_build_object('email', (select u.email from public.business_members m join auth.users u on u.id = m.user_id
                                          where m.business_id = b.id and m.role = 'owner' order by m.created_at limit 1))
  )
  from public.notification_log n
  join public.businesses b on b.id = n.business_id
  left join public.appointments a on a.id = n.appointment_id
  left join public.waitlist_offers o on o.id = n.offer_id
  left join public.waitlist_entries e on e.id = o.entry_id
  left join public.services sv on sv.id = e.service_id
  join public.customers c on c.id = coalesce(a.customer_id, e.customer_id)
  where n.id = p_id
$$;

-- ------------------------------------------------------------------ core: offer a freed slot to the next in line
create function private.waitlist_offer_for_slot(p_business uuid, p_starts_at timestamptz, p_freed_until timestamptz, p_force_entry uuid default null, p_ignore_auto boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses; e public.waitlist_entries; s public.services;
  v_offer uuid; v_exp timestamptz; v_local timestamp; v_min int;
begin
  select * into b from public.businesses where id = p_business and published_at is not null;
  if not found or not b.waitlist_enabled then return null; end if;
  if not p_ignore_auto and not b.waitlist_auto_offer then return null; end if;                      -- WLT-06
  if p_starts_at < now() + make_interval(mins => b.min_notice_minutes) then return null; end if;
  if exists (select 1 from public.appointments a where a.business_id = p_business and a.status in ('pending','confirmed','cancellation_requested')
             and tstzrange(a.starts_at, a.blocked_until, '[)') && tstzrange(p_starts_at, p_freed_until, '[)')) then return null; end if;   -- the hole must really be free
  v_local := p_starts_at at time zone b.timezone;
  v_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  select w.* into e from public.waitlist_entries w join public.services sv on sv.id = w.service_id
   where w.business_id = p_business and w.status = 'waiting' and w.on_date = v_local::date and (p_force_entry is null or w.id = p_force_entry)
     and sv.active and sv.capacity = 1
     and sv.duration_minutes + sv.buffer_minutes <= extract(epoch from (p_freed_until - p_starts_at)) / 60
     and (w.from_minute is null or (v_min >= w.from_minute and v_min + sv.duration_minutes <= w.to_minute))
     and not exists (select 1 from public.waitlist_offers o where o.entry_id = w.id and o.slot_starts_at = p_starts_at)
   order by w.created_at, w.id                                                                         -- WLT-01: first come, first served
   limit 1 for update of w skip locked;
  if not found then return null; end if;
  select * into s from public.services where id = e.service_id;
  v_exp := least(now() + make_interval(mins => b.waitlist_offer_minutes), p_starts_at - interval '10 minutes');
  if v_exp <= now() + interval '1 minute' then return null; end if;
  begin
    insert into public.waitlist_offers (business_id, entry_id, slot_starts_at, slot_ends_at, blocked_until, freed_until, expires_at)
    values (p_business, e.id, p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes), p_starts_at + make_interval(mins => s.duration_minutes + s.buffer_minutes), p_freed_until, v_exp)
    returning id into v_offer;
  exception when exclusion_violation then return null;                                                 -- another live offer already holds this time
  end;
  update public.waitlist_entries set status = 'offered' where id = e.id;
  perform private.notif_enqueue_offer(v_offer, 'waitlist_offer');
  return v_offer;
end $$;

-- A cancellation / rejection frees a slot: offer it in the same transaction (WLT-01).
create or replace function private.public_cancel(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.appointments; b public.businesses;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  select * into b from public.businesses where id = a.business_id;
  if a.status not in ('pending','confirmed') then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
  if now() > a.starts_at - make_interval(hours => b.cancel_until_hours) then raise exception 'too_late' using errcode = 'P0001'; end if;
  update public.appointments set status = 'cancelled_by_customer', cancelled_at = now() where id = p_id;
  perform private.enqueue_event(a.business_id, 'AppointmentCancelled', jsonb_build_object('appointmentId', a.id, 'by', 'customer'), 'cancel:' || a.id::text);
  perform private.waitlist_offer_for_slot(a.business_id, a.starts_at, a.blocked_until);
  return jsonb_build_object('id', a.id, 'status', 'cancelled_by_customer');
end $$;

create or replace function private.transition_appointment_impl(p_id uuid, p_action text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.appointments; v_to text;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into a from public.appointments where id = p_id for update;
  if not found or not private.is_member(a.business_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  v_to := case p_action when 'approve' then 'confirmed' when 'reject' then 'cancelled_by_business' when 'cancel' then 'cancelled_by_business'
                        when 'complete' then 'completed' when 'no_show' then 'no_show' when 'approve_cancellation' then 'cancelled_by_customer'
                        when 'decline_cancellation' then 'confirmed' end;
  if v_to is null then raise exception 'invalid_action' using errcode = '23514'; end if;
  if v_to = a.status then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
  if v_to in ('completed', 'no_show') and a.starts_at > now() then raise exception 'too_early' using errcode = 'P0001'; end if;
  update public.appointments set status = v_to, cancelled_at = case when v_to like 'cancelled%' then now() else cancelled_at end where id = p_id;
  perform private.audit_write(a.business_id, 'appointment.' || p_action, 'appointment', p_id::text, jsonb_build_object('from', a.status, 'to', v_to));
  if v_to in ('confirmed', 'cancelled_by_business', 'cancelled_by_customer') then
    perform private.enqueue_event(a.business_id, 'AppointmentStatusChanged', jsonb_build_object('appointmentId', p_id, 'action', p_action, 'to', v_to), 'st:' || p_id::text || ':' || p_action);
  end if;
  if v_to like 'cancelled%' then
    perform private.waitlist_offer_for_slot(a.business_id, a.starts_at, a.blocked_until);                 -- WLT-01
  end if;
  return jsonb_build_object('id', p_id, 'status', v_to);
end $$;

-- The public catalogue says whether customers may join the waitlist.
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
      'requiresApproval', b.requires_approval, 'cancelUntilHours', b.cancel_until_hours, 'minNoticeMinutes', b.min_notice_minutes, 'horizonDays', b.booking_horizon_days, 'waitlistEnabled', b.waitlist_enabled),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', coalesce(s.description, ''), 'durationMinutes', s.duration_minutes,
        'bufferMinutes', s.buffer_minutes, 'priceCents', s.price_cents, 'requiresApproval', s.requires_approval) order by s.position, s.created_at)
        from public.services s where s.business_id = b.id and s.active and s.capacity = 1), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('weekday', r.weekday, 'startMinute', r.start_minute, 'endMinute', r.end_minute))
        from public.availability_rules r where r.business_id = b.id and r.resource_id = v_res), '[]'::jsonb),
    'exceptions', coalesce((select jsonb_agg(jsonb_build_object('date', e.on_date, 'kind', e.kind, 'startMinute', e.start_minute, 'endMinute', e.end_minute))
        from public.availability_exceptions e where e.business_id = b.id and e.resource_id = v_res and e.on_date >= (current_date - 2)), '[]'::jsonb)
  );
end $$;

-- ------------------------------------------------------------------ customer side (system path)
create function private.waitlist_join_impl(p_business uuid, p_service uuid, p_date date, p_from int, p_to int, p_full_name text, p_phone text, p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.businesses; s public.services; v_cust uuid; v_entry public.waitlist_entries; v_existing public.waitlist_entries;
begin
  select * into b from public.businesses where id = p_business and published_at is not null;
  if not found or not b.waitlist_enabled then raise exception 'not_found' using errcode = 'P0001'; end if;
  select * into s from public.services where id = p_service and business_id = p_business and active and capacity = 1;
  if not found then raise exception 'service_unavailable' using errcode = 'P0001'; end if;
  if nullif(btrim(coalesce(p_email, '')), '') is null then raise exception 'email_required' using errcode = '23514'; end if;       -- offers travel by e-mail
  if p_date < (now() at time zone b.timezone)::date or p_date > (now() at time zone b.timezone)::date + b.booking_horizon_days then raise exception 'date_out_of_range' using errcode = 'P0001'; end if;
  insert into public.customers (business_id, full_name, phone, email) values (p_business, btrim(p_full_name), p_phone, btrim(p_email))
  on conflict (business_id, phone) do update set full_name = excluded.full_name, email = excluded.email
  returning id into v_cust;
  select * into v_existing from public.waitlist_entries where business_id = p_business and customer_id = v_cust and service_id = p_service and on_date = p_date and status in ('waiting','offered');
  if found then return jsonb_build_object('replay', true, 'id', v_existing.id, 'status', v_existing.status); end if;                   -- idempotent
  if (select count(*) from public.waitlist_entries where business_id = p_business and customer_id = v_cust and status in ('waiting','offered')) >= 3 then
    raise exception 'waitlist_limit' using errcode = 'P0001';                                                                          -- WLT-08
  end if;
  insert into public.waitlist_entries (business_id, service_id, customer_id, on_date, from_minute, to_minute) values (p_business, p_service, v_cust, p_date, p_from, p_to) returning * into v_entry;
  return jsonb_build_object('replay', false, 'id', v_entry.id, 'status', v_entry.status);
end $$;

create function private.waitlist_view(p_entry uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'status', e.status, 'onDate', e.on_date, 'fromMinute', e.from_minute, 'toMinute', e.to_minute,
    'serviceName', s.name, 'businessName', b.name, 'businessSlug', b.slug, 'timezone', b.timezone,
    'offer', (select jsonb_build_object('id', o.id, 'slotStartsAt', o.slot_starts_at, 'slotEndsAt', o.slot_ends_at, 'expiresAt', o.expires_at)
              from public.waitlist_offers o where o.entry_id = e.id and o.status = 'pending' and o.expires_at > now() order by o.created_at desc limit 1),
    'booking', (select jsonb_build_object('startsAt', a.starts_at, 'reference', a.reference, 'status', a.status)
                from public.waitlist_offers o join public.appointments a on a.id = o.appointment_id where o.entry_id = e.id and o.status = 'accepted' order by o.resolved_at desc limit 1))
  from public.waitlist_entries e join public.services s on s.id = e.service_id join public.businesses b on b.id = e.business_id
  where e.id = p_entry
$$;

-- Accept an offer: the appointment is created with the same EXCLUDE as any booking, so a race with a public/manual booking has one winner (WLT-02/04).
create function private.waitlist_accept_impl(p_offer uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.waitlist_offers; e public.waitlist_entries; b public.businesses; s public.services; v_appt public.appointments; v_ref text; v_status text; v_tries int := 0; v_res uuid;
begin
  select * into o from public.waitlist_offers where id = p_offer for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if o.status <> 'pending' then return jsonb_build_object('outcome', 'not_pending', 'status', o.status); end if;
  select * into e from public.waitlist_entries where id = o.entry_id for update;
  if o.expires_at <= now() then
    update public.waitlist_offers set status = 'expired', resolved_at = now() where id = o.id;
    update public.waitlist_entries set status = 'waiting' where id = e.id and status = 'offered';
    perform private.notif_enqueue_offer(o.id, 'waitlist_offer_expired');
    perform private.waitlist_offer_for_slot(o.business_id, o.slot_starts_at, o.freed_until);
    return jsonb_build_object('outcome', 'expired');
  end if;
  select * into b from public.businesses where id = o.business_id;
  select * into s from public.services where id = e.service_id;
  select id into v_res from public.resources where business_id = o.business_id and is_default;
  v_status := case when coalesce(s.requires_approval, b.requires_approval) then 'pending' else 'confirmed' end;
  loop
    v_ref := 'TR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
      values (o.business_id, v_res, s.id, e.customer_id, v_ref, v_status, o.slot_starts_at, o.slot_ends_at, o.blocked_until,
              jsonb_build_object('name', s.name, 'durationMinutes', s.duration_minutes, 'bufferMinutes', s.buffer_minutes, 'priceCents', s.price_cents), s.price_cents, s.currency)
      returning * into v_appt;
      exit;
    exception
      when exclusion_violation then
        update public.waitlist_offers set status = 'lost', resolved_at = now() where id = o.id;                 -- WLT-04: someone else took the slot
        update public.waitlist_entries set status = 'waiting' where id = e.id;
        return jsonb_build_object('outcome', 'slot_taken');
      when unique_violation then
        v_tries := v_tries + 1;
        if v_tries > 5 then raise; end if;
    end;
  end loop;
  update public.waitlist_offers set status = 'accepted', resolved_at = now(), appointment_id = v_appt.id where id = o.id;
  update public.waitlist_entries set status = 'booked' where id = e.id;
  perform private.enqueue_event(o.business_id, 'AppointmentCreated', jsonb_build_object('appointmentId', v_appt.id, 'via', 'waitlist'), 'appt:' || v_appt.id::text);
  return jsonb_build_object('outcome', 'accepted', 'id', v_appt.id, 'reference', v_appt.reference, 'status', v_appt.status, 'startsAt', v_appt.starts_at);
end $$;

-- Decline the live offer (stay on the list, the slot goes to the next) / leave the list altogether.
create function private.waitlist_decline_impl(p_offer uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.waitlist_offers;
begin
  select * into o from public.waitlist_offers where id = p_offer for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if o.status <> 'pending' then return jsonb_build_object('outcome', 'not_pending', 'status', o.status); end if;
  update public.waitlist_offers set status = 'declined', resolved_at = now() where id = o.id;
  update public.waitlist_entries set status = 'waiting' where id = o.entry_id and status = 'offered';
  perform private.waitlist_offer_for_slot(o.business_id, o.slot_starts_at, o.freed_until);
  return jsonb_build_object('outcome', 'declined');
end $$;

create function private.waitlist_leave_impl(p_entry uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.waitlist_entries; o public.waitlist_offers;
begin
  select * into e from public.waitlist_entries where id = p_entry for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if e.status not in ('waiting','offered') then return jsonb_build_object('outcome', 'not_active', 'status', e.status); end if;
  update public.waitlist_entries set status = 'cancelled' where id = e.id;
  for o in select * from public.waitlist_offers where entry_id = e.id and status = 'pending' for update loop
    update public.waitlist_offers set status = 'declined', resolved_at = now() where id = o.id;
    perform private.waitlist_offer_for_slot(o.business_id, o.slot_starts_at, o.freed_until);
  end loop;
  return jsonb_build_object('outcome', 'left');
end $$;

-- ------------------------------------------------------------------ sweep (WLT-03/05): expire, release, tidy. Idempotent.
create function private.waitlist_sweep_impl(p_now timestamptz default now()) returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.waitlist_offers; v_expired int := 0; v_lost int := 0; v_past int := 0; v_elsewhere int := 0;
begin
  for o in select * from public.waitlist_offers where status = 'pending' and expires_at <= p_now order by expires_at for update skip locked loop
    update public.waitlist_offers set status = 'expired', resolved_at = p_now where id = o.id;
    update public.waitlist_entries set status = 'waiting' where id = o.entry_id and status = 'offered';
    perform private.notif_enqueue_offer(o.id, 'waitlist_offer_expired');                                      -- the original recipient is told
    perform private.waitlist_offer_for_slot(o.business_id, o.slot_starts_at, o.freed_until);                  -- and the slot moves on
    v_expired := v_expired + 1;
  end loop;
  for o in select wo.* from public.waitlist_offers wo where wo.status = 'pending' and exists (
             select 1 from public.appointments a where a.business_id = wo.business_id and a.status in ('pending','confirmed','cancellation_requested')
             and tstzrange(a.starts_at, a.blocked_until, '[)') && tstzrange(wo.slot_starts_at, wo.blocked_until, '[)')) for update skip locked loop
    update public.waitlist_offers set status = 'lost', resolved_at = p_now where id = o.id;                   -- someone booked it meanwhile
    update public.waitlist_entries set status = 'waiting' where id = o.entry_id and status = 'offered';
    v_lost := v_lost + 1;
  end loop;
  update public.waitlist_entries w set status = 'cancelled' from public.businesses b
   where b.id = w.business_id and w.status in ('waiting','offered') and w.on_date < (p_now at time zone b.timezone)::date;
  get diagnostics v_past = row_count;
  update public.waitlist_entries w set status = 'booked' from public.businesses b                              -- WLT-05: already booked the same thing
   where b.id = w.business_id and w.status = 'waiting' and exists (
     select 1 from public.appointments a where a.customer_id = w.customer_id and a.service_id = w.service_id
       and a.status in ('pending','confirmed') and (a.starts_at at time zone b.timezone)::date = w.on_date);
  get diagnostics v_elsewhere = row_count;
  return jsonb_build_object('expired', v_expired, 'lost', v_lost, 'pastCancelled', v_past, 'bookedElsewhere', v_elsewhere);
end $$;

-- ------------------------------------------------------------------ owner side (RLS user)
create function private.waitlist_manual_offer_impl(p_entry uuid, p_starts_at timestamptz) returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.waitlist_entries; s public.services; v_offer uuid;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into e from public.waitlist_entries where id = p_entry;
  if not found or not private.is_member(e.business_id, 'staff') then raise exception 'forbidden' using errcode = '42501'; end if;
  if e.status <> 'waiting' then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  select * into s from public.services where id = e.service_id;
  v_offer := private.waitlist_offer_for_slot(e.business_id, p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes + s.buffer_minutes), e.id, true);
  if v_offer is null then raise exception 'slot_unavailable' using errcode = 'P0001'; end if;
  perform private.audit_write(e.business_id, 'waitlist.manual_offer', 'waitlist_entry', e.id::text, '{}'::jsonb);
  return v_offer;
end $$;

create function private.waitlist_owner_remove_impl(p_entry uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.waitlist_entries;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into e from public.waitlist_entries where id = p_entry;
  if not found or not private.is_member(e.business_id, 'staff') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.audit_write(e.business_id, 'waitlist.remove', 'waitlist_entry', e.id::text, '{}'::jsonb);
  return private.waitlist_leave_impl(p_entry);
end $$;

-- ------------------------------------------------------------------ wrappers + grants
create function public.waitlist_join(p_business uuid, p_service uuid, p_date date, p_from int, p_to int, p_full_name text, p_phone text, p_email text)
  returns jsonb language sql security invoker set search_path = '' as $$ select private.waitlist_join_impl(p_business, p_service, p_date, p_from, p_to, p_full_name, p_phone, p_email) $$;
create function public.waitlist_view(p_entry uuid) returns jsonb language sql stable security invoker set search_path = '' as $$ select private.waitlist_view(p_entry) $$;
create function public.waitlist_accept(p_offer uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.waitlist_accept_impl(p_offer) $$;
create function public.waitlist_decline(p_offer uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.waitlist_decline_impl(p_offer) $$;
create function public.waitlist_leave(p_entry uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.waitlist_leave_impl(p_entry) $$;
create function public.waitlist_sweep(p_now timestamptz) returns jsonb language sql security invoker set search_path = '' as $$ select private.waitlist_sweep_impl(p_now) $$;
create function public.waitlist_manual_offer(p_entry uuid, p_starts_at timestamptz) returns uuid language sql security invoker set search_path = '' as $$ select private.waitlist_manual_offer_impl(p_entry, p_starts_at) $$;
create function public.waitlist_owner_remove(p_entry uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.waitlist_owner_remove_impl(p_entry) $$;

do $$
declare f text;
begin
  for f in select unnest(array[
    'private.notif_enqueue_offer(uuid,text)', 'private.waitlist_offer_for_slot(uuid,timestamptz,timestamptz,uuid,boolean)',
    'private.waitlist_join_impl(uuid,uuid,date,int,int,text,text,text)', 'private.waitlist_view(uuid)', 'private.waitlist_accept_impl(uuid)',
    'private.waitlist_decline_impl(uuid)', 'private.waitlist_leave_impl(uuid)', 'private.waitlist_sweep_impl(timestamptz)',
    'private.waitlist_manual_offer_impl(uuid,timestamptz)', 'private.waitlist_owner_remove_impl(uuid)',
    'public.waitlist_join(uuid,uuid,date,int,int,text,text,text)', 'public.waitlist_view(uuid)', 'public.waitlist_accept(uuid)', 'public.waitlist_decline(uuid)',
    'public.waitlist_leave(uuid)', 'public.waitlist_sweep(timestamptz)', 'public.waitlist_manual_offer(uuid,timestamptz)', 'public.waitlist_owner_remove(uuid)'
  ]) loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- system path: service_role only
  for f in select unnest(array[
    'private.notif_enqueue_offer(uuid,text)', 'private.waitlist_offer_for_slot(uuid,timestamptz,timestamptz,uuid,boolean)',
    'private.waitlist_join_impl(uuid,uuid,date,int,int,text,text,text)', 'private.waitlist_view(uuid)', 'private.waitlist_accept_impl(uuid)',
    'private.waitlist_decline_impl(uuid)', 'private.waitlist_leave_impl(uuid)', 'private.waitlist_sweep_impl(timestamptz)',
    'public.waitlist_join(uuid,uuid,date,int,int,text,text,text)', 'public.waitlist_view(uuid)', 'public.waitlist_accept(uuid)', 'public.waitlist_decline(uuid)',
    'public.waitlist_leave(uuid)', 'public.waitlist_sweep(timestamptz)'
  ]) loop
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- owner path: authenticated (membership is checked inside); the definer helpers they call run as owner of the function
  for f in select unnest(array[
    'private.waitlist_manual_offer_impl(uuid,timestamptz)', 'private.waitlist_owner_remove_impl(uuid)',
    'public.waitlist_manual_offer(uuid,timestamptz)', 'public.waitlist_owner_remove(uuid)'
  ]) loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
