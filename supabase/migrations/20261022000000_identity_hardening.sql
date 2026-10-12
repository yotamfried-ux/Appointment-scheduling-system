-- Stage 11 hardening from the independent security review.
-- 1. Identity: an anonymous booking or waitlist join must never rewrite an EXISTING customer (name, e-mail), and notifications go to the address given WITH THAT
--    appointment / waitlist entry, not to whatever the customer row holds today. A phone number is not proof of identity.
-- 2. Waitlist replay: the manage link of an existing entry is returned only to the caller that created it (idempotency proof), never to whoever knows the phone.
-- 3. Invariants by grants, not convention (billing, audit, platform admins); audit gaps; the export page function; outbox lease; entitlement edge cases; a lint rule.

alter table public.appointments add column contact_email text check (contact_email is null or char_length(contact_email) <= 254);
alter table public.waitlist_entries add column contact_email text check (contact_email is null or char_length(contact_email) <= 254);
alter table public.waitlist_entries add column idem_hash text check (idem_hash is null or char_length(idem_hash) <= 128);
-- existing rows keep sending to the address they were created with
update public.appointments a set contact_email = c.email from public.customers c where c.id = a.customer_id and a.contact_email is null and c.email is not null;
update public.waitlist_entries w set contact_email = c.email from public.customers c where c.id = w.customer_id and w.contact_email is null and c.email is not null;

-- the contact address of an appointment is fixed at booking; only erasure may clear it
create or replace function private.appointments_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_anon boolean := coalesce(current_setting('app.anonymizing', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.resources r where r.id = new.resource_id and r.business_id = new.business_id)
       or not exists (select 1 from public.services s where s.id = new.service_id and s.business_id = new.business_id)
       or not exists (select 1 from public.customers c where c.id = new.customer_id and c.business_id = new.business_id) then
      raise exception 'tenant_mismatch' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.business_id <> old.business_id or new.resource_id <> old.resource_id or new.service_id <> old.service_id or new.customer_id <> old.customer_id
     or new.starts_at <> old.starts_at or new.ends_at <> old.ends_at or new.blocked_until <> old.blocked_until or new.reference <> old.reference
     or new.service_snapshot <> old.service_snapshot or new.price_cents <> old.price_cents or new.location <> old.location
     or new.source <> old.source or new.out_of_availability <> old.out_of_availability
     or (not v_anon and (new.intake <> old.intake or new.owner_note is distinct from old.owner_note))
     or (new.contact_email is distinct from old.contact_email and not (v_anon and new.contact_email is null)) then
    raise exception 'appointment_immutable' using errcode = 'P0001';
  end if;
  if new.status <> old.status and not (
       (old.status = 'pending' and new.status in ('confirmed','cancelled_by_business','cancelled_by_customer'))
    or (old.status = 'confirmed' and new.status in ('completed','no_show','cancelled_by_customer','cancelled_by_business','cancellation_requested'))
    or (old.status = 'cancellation_requested' and new.status in ('cancelled_by_customer','cancelled_by_business','confirmed'))
    or (old.status = 'completed' and new.status = 'no_show')           -- NSH-04: marked wrongly, corrected both ways
    or (old.status = 'no_show' and new.status = 'completed')
  ) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- booking: the e-mail travels with the appointment
create or replace function private.public_book(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_email text, p_location text, p_intake jsonb, p_idem_key text, p_request_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses;
  s public.services;
  v_res uuid;
  v_cust uuid;
  v_appt public.appointments;
  v_prior public.booking_idempotency;
  v_ref text;
  v_status text;
  v_tries int := 0;
begin
  select * into b from public.businesses where id = p_business and published_at is not null;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;

  -- BKG-04: same key + same request ⇒ the same appointment; same key + different request ⇒ refused.
  select * into v_prior from public.booking_idempotency where business_id = p_business and idem_key = p_idem_key;
  if found then
    if v_prior.request_hash <> p_request_hash then raise exception 'idempotency_reuse' using errcode = 'P0001'; end if;
    select * into v_appt from public.appointments where id = v_prior.appointment_id;
    return jsonb_build_object('replay', true, 'id', v_appt.id, 'reference', v_appt.reference, 'status', v_appt.status, 'startsAt', v_appt.starts_at, 'endsAt', v_appt.ends_at);
  end if;

  select * into s from public.services where id = p_service and business_id = p_business and active and capacity = 1;
  if not found then raise exception 'service_unavailable' using errcode = 'P0001'; end if;           -- BKG-10
  select id into v_res from public.resources where business_id = p_business and is_default;
  if p_starts_at < now() + make_interval(mins => b.min_notice_minutes) then raise exception 'slot_in_past' using errcode = 'P0001'; end if;
  if p_starts_at > now() + make_interval(days => b.booking_horizon_days) then raise exception 'slot_too_far' using errcode = 'P0001'; end if;

  insert into public.customers (business_id, full_name, phone, email) values (p_business, btrim(p_full_name), p_phone, nullif(btrim(coalesce(p_email, '')), ''))
  on conflict (business_id, phone) do update set full_name = public.customers.full_name   -- BKG-05: one customer per phone; an anonymous request never rewrites an existing one (identity is not proven)
  returning id into v_cust;

  -- BKG-07: bounded number of future active appointments per customer.
  if (select count(*) from public.appointments where business_id = p_business and customer_id = v_cust and starts_at > now()
        and status in ('pending','confirmed','cancellation_requested')) >= 5 then
    raise exception 'booking_limit' using errcode = 'P0001';
  end if;

  v_status := case when coalesce(s.requires_approval, b.requires_approval) then 'pending' else 'confirmed' end;   -- BKG-09
  loop
    v_ref := 'TR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.appointments (business_id, resource_id, service_id, customer_id, contact_email, reference, status, location, intake, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
      values (p_business, v_res, s.id, v_cust, nullif(btrim(coalesce(p_email, '')), ''), v_ref, v_status, coalesce(p_location, 'business'), coalesce(p_intake, '{}'::jsonb), p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes),
              p_starts_at + make_interval(mins => s.duration_minutes + s.buffer_minutes),
              jsonb_build_object('name', s.name, 'durationMinutes', s.duration_minutes, 'bufferMinutes', s.buffer_minutes, 'priceCents', s.price_cents), s.price_cents, s.currency)
      returning * into v_appt;
      exit;
    exception
      when exclusion_violation then raise exception 'slot_taken' using errcode = 'P0001';       -- BKG-02 → HTTP 409
      when unique_violation then
        v_tries := v_tries + 1;
        if v_tries > 5 then raise; end if;                                                         -- reference collision: retry
    end;
  end loop;
  insert into public.booking_idempotency (business_id, idem_key, request_hash, appointment_id) values (p_business, p_idem_key, p_request_hash, v_appt.id);
  perform private.enqueue_event(p_business, 'AppointmentCreated', jsonb_build_object('appointmentId', v_appt.id), 'appt:' || v_appt.id::text);
  return jsonb_build_object('replay', false, 'id', v_appt.id, 'reference', v_appt.reference, 'status', v_appt.status, 'startsAt', v_appt.starts_at, 'endsAt', v_appt.ends_at);
end $$;

-- owner-created appointment: the owner is trusted, so it uses the address already on file for that customer
create or replace function private.create_manual_appointment_impl(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_note text, p_out_of_availability boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.services;
  v_res uuid;
  v_cust uuid;
  v_appt public.appointments;
  v_ref text;
  v_tries int := 0;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not private.is_member(p_business, 'staff') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from public.services where id = p_service and business_id = p_business and active and capacity = 1;
  if not found then raise exception 'service_unavailable' using errcode = 'P0001'; end if;
  select id into v_res from public.resources where business_id = p_business and is_default;
  if p_starts_at < now() - interval '24 hours' then raise exception 'slot_in_past' using errcode = 'P0001'; end if;
  if p_starts_at > now() + interval '400 days' then raise exception 'slot_too_far' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_full_name, ''))) < 2 or char_length(p_full_name) > 80 then raise exception 'invalid_name' using errcode = '23514'; end if;

  insert into public.customers (business_id, full_name, phone) values (p_business, btrim(p_full_name), p_phone)
  on conflict (business_id, phone) do update set full_name = public.customers.full_name
  returning id into v_cust;

  loop
    v_ref := 'TR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.appointments (business_id, resource_id, service_id, customer_id, contact_email, reference, status, source, out_of_availability, owner_note, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
      values (p_business, v_res, s.id, v_cust, (select email from public.customers where id = v_cust), v_ref, 'confirmed', 'manual', coalesce(p_out_of_availability, false), nullif(btrim(coalesce(p_note, '')), ''),
              p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes), p_starts_at + make_interval(mins => s.duration_minutes + s.buffer_minutes),
              jsonb_build_object('name', s.name, 'durationMinutes', s.duration_minutes, 'bufferMinutes', s.buffer_minutes, 'priceCents', s.price_cents), s.price_cents, s.currency)
      returning * into v_appt;
      exit;
    exception
      when exclusion_violation then raise exception 'slot_taken' using errcode = 'P0001';
      when unique_violation then
        v_tries := v_tries + 1;
        if v_tries > 5 then raise; end if;
    end;
  end loop;
  perform private.audit_write(p_business, 'appointment.manual_create', 'appointment', v_appt.id::text, jsonb_build_object('outOfAvailability', coalesce(p_out_of_availability, false)));
  return jsonb_build_object('id', v_appt.id, 'reference', v_appt.reference, 'status', v_appt.status, 'startsAt', v_appt.starts_at, 'endsAt', v_appt.ends_at);
end $$;

drop function public.waitlist_join(uuid, uuid, date, int, int, text, text, text);
drop function private.waitlist_join_impl(uuid, uuid, date, int, int, text, text, text);
create function private.waitlist_join_impl(p_business uuid, p_service uuid, p_date date, p_from int, p_to int, p_full_name text, p_phone text, p_email text, p_idem_hash text default null)
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
  on conflict (business_id, phone) do update set full_name = public.customers.full_name
  returning id into v_cust;
  select * into v_existing from public.waitlist_entries where business_id = p_business and customer_id = v_cust and service_id = p_service and on_date = p_date and status in ('waiting','offered');
  if found then   -- idempotent; but the caller gets to manage the entry only if it can prove it created it (the same idempotency key), not merely by knowing the phone
    return jsonb_build_object('replay', true, 'id', v_existing.id, 'status', v_existing.status, 'owner', p_idem_hash is not null and v_existing.idem_hash = p_idem_hash);
  end if;
  if (select count(*) from public.waitlist_entries where business_id = p_business and customer_id = v_cust and status in ('waiting','offered')) >= 3 then
    raise exception 'waitlist_limit' using errcode = 'P0001';                                                                          -- WLT-08
  end if;
  insert into public.waitlist_entries (business_id, service_id, customer_id, contact_email, idem_hash, on_date, from_minute, to_minute) values (p_business, p_service, v_cust, btrim(p_email), p_idem_hash, p_date, p_from, p_to) returning * into v_entry;
  return jsonb_build_object('replay', false, 'owner', true, 'id', v_entry.id, 'status', v_entry.status);
end $$;

create function public.waitlist_join(p_business uuid, p_service uuid, p_date date, p_from int, p_to int, p_full_name text, p_phone text, p_email text, p_idem_hash text default null)
  returns jsonb language sql security invoker set search_path = '' as $$ select private.waitlist_join_impl(p_business, p_service, p_date, p_from, p_to, p_full_name, p_phone, p_email, p_idem_hash) $$;
revoke all on function private.waitlist_join_impl(uuid, uuid, date, int, int, text, text, text, text), public.waitlist_join(uuid, uuid, date, int, int, text, text, text, text) from public, anon, authenticated;
grant execute on function private.waitlist_join_impl(uuid, uuid, date, int, int, text, text, text, text), public.waitlist_join(uuid, uuid, date, int, int, text, text, text, text) to service_role;

-- accepting an offer books with the address the entry was created with
create or replace function private.waitlist_accept_impl(p_offer uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
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
      insert into public.appointments (business_id, resource_id, service_id, customer_id, contact_email, reference, status, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
      values (o.business_id, v_res, s.id, e.customer_id, e.contact_email, v_ref, v_status, o.slot_starts_at, o.slot_ends_at, o.blocked_until,
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

-- notifications go to the address given with the appointment / entry
create or replace function private.notif_context(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', n.id, 'type', n.type, 'recipient', n.recipient, 'attempts', n.attempts,
    'appointment', case when a.id is null then null else jsonb_build_object('id', a.id, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at, 'reference', a.reference,
                                      'serviceName', a.service_snapshot->>'name', 'location', a.location) end,
    'offer', case when o.id is null then null else jsonb_build_object('id', o.id, 'status', o.status, 'slotStartsAt', o.slot_starts_at, 'expiresAt', o.expires_at,
                                      'serviceName', sv.name, 'entryId', o.entry_id) end,
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
  join public.customers c on c.id = coalesce(a.customer_id, e.customer_id)
  where n.id = p_id
$$;

-- erasure also clears the per-appointment addresses
create or replace function private.anonymize_customer_impl(p_customer uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.customers; v_phone text; v_tries int := 0; v_waitlist int;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into c from public.customers where id = p_customer for update;
  if not found or not private.is_member(c.business_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if c.anonymized_at is not null then return jsonb_build_object('outcome', 'already'); end if;
  if exists (select 1 from public.appointments a where a.customer_id = c.id and a.status in ('pending', 'confirmed', 'cancellation_requested') and a.starts_at > now()) then
    return jsonb_build_object('outcome', 'has_upcoming');                      -- cancel or finish the future appointments first
  end if;
  update public.waitlist_entries set status = 'cancelled' where customer_id = c.id and status in ('waiting', 'offered');
  get diagnostics v_waitlist = row_count;
  perform set_config('app.anonymizing', 'on', true);
  update public.appointments set intake = '{}'::jsonb, owner_note = null, contact_email = null where customer_id = c.id;
  update public.waitlist_entries set contact_email = null where customer_id = c.id;
  loop
    v_phone := '+999' || lpad((('x' || substr(md5(c.id::text || v_tries::text), 1, 8))::bit(32)::bigint)::text, 10, '0');
    begin
      update public.customers set full_name = 'לקוח שנמחק', phone = v_phone, email = null, notes = null, anonymized_at = now() where id = c.id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 5 then raise; end if;
    end;
  end loop;
  perform set_config('app.anonymizing', 'off', true);
  perform private.audit_write(c.business_id, 'customer.anonymize', 'customer', c.id::text, jsonb_build_object('waitlistClosed', v_waitlist));
  return jsonb_build_object('outcome', 'anonymized');
end $$;

create or replace function private.set_customer_notes_impl(p_customer uuid, p_notes text) returns void language plpgsql security definer set search_path = '' as $$
declare c public.customers;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into c from public.customers where id = p_customer;
  if not found or not private.is_member(c.business_id, 'staff') then raise exception 'forbidden' using errcode = '42501'; end if;
  if c.anonymized_at is not null then raise exception 'anonymized' using errcode = 'P0001'; end if;
  if char_length(coalesce(p_notes, '')) > 500 then raise exception 'notes_too_long' using errcode = '23514'; end if;
  update public.customers set notes = nullif(btrim(coalesce(p_notes, '')), '') where id = p_customer;
  perform private.audit_write(c.business_id, 'customer.notes', 'customer', p_customer::text, jsonb_build_object('length', char_length(coalesce(p_notes, ''))));   -- that notes changed, never what they say
end $$;

-- billing events: a sane timestamp, and the admin's reason is part of the audit row
create or replace function private.billing_apply_event(p_provider text, p_event_id text, p_type text, p_occurred_at timestamptz, p_business uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.subscriptions; v_new_status text; v_plan text; v_inserted int; v_before text;
  v_outcome text := 'applied';
begin
  if p_provider is null or p_event_id is null or p_type not in ('subscription.updated', 'subscription.canceled', 'payment.failed', 'payment.succeeded')
     or p_occurred_at is null or p_occurred_at > now() + interval '1 day' then       -- a far-future timestamp would make every later (real) event look stale
    raise exception 'invalid_event' using errcode = '23514';
  end if;
  insert into public.billing_events (business_id, provider, event_id, type, occurred_at, outcome)
  values ((select id from public.businesses where id = p_business), p_provider, p_event_id, p_type, p_occurred_at, 'pending')
  on conflict (provider, event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return jsonb_build_object('outcome', 'duplicate'); end if;

  select * into s from public.subscriptions where business_id = p_business for update;
  if not found then
    update public.billing_events set outcome = 'unknown_business' where provider = p_provider and event_id = p_event_id;
    return jsonb_build_object('outcome', 'unknown_business');
  end if;
  if s.last_event_at is not null and p_occurred_at < s.last_event_at then
    update public.billing_events set outcome = 'stale' where provider = p_provider and event_id = p_event_id;
    return jsonb_build_object('outcome', 'stale');                   -- an older fact never overrides a newer one
  end if;

  v_before := s.status;
  v_new_status := case p_type
    when 'payment.failed' then 'past_due'
    when 'payment.succeeded' then 'active'
    when 'subscription.canceled' then 'canceled'
    else coalesce(nullif(p_data->>'status', ''), s.status) end;
  if v_new_status not in ('trialing', 'active', 'past_due', 'canceled') then v_new_status := s.status; v_outcome := 'invalid_status'; end if;
  v_plan := nullif(p_data->>'planId', '');
  if v_plan is not null and not exists (select 1 from public.plans where id = v_plan and active) then v_plan := null; v_outcome := 'invalid_plan'; end if;

  update public.subscriptions set
    status = v_new_status,
    plan_id = coalesce(v_plan, plan_id),
    plan_version = case when v_plan is not null then (select version from public.plans where id = v_plan) else plan_version end,
    current_period_end = coalesce((p_data->>'currentPeriodEnd')::timestamptz, current_period_end),
    cancel_at_period_end = coalesce((p_data->>'cancelAtPeriodEnd')::boolean, case when v_new_status = 'canceled' then true else cancel_at_period_end end),
    trial_ends_at = coalesce((p_data->>'trialEnd')::timestamptz, trial_ends_at),
    grace_until = case when v_new_status = 'past_due' then coalesce(s.grace_until, p_occurred_at + interval '7 days')   -- BIL-02: the clock starts at the first failure
                       else null end,
    provider = p_provider,
    external_customer_id = coalesce(nullif(p_data->>'externalCustomerId', ''), external_customer_id),
    external_subscription_id = coalesce(nullif(p_data->>'externalSubscriptionId', ''), external_subscription_id),
    last_event_at = p_occurred_at,
    updated_at = now()
  where business_id = p_business;
  update public.billing_events set outcome = v_outcome where provider = p_provider and event_id = p_event_id;
  perform private.audit_write(p_business, 'billing.' || p_type, 'subscription', p_business::text, jsonb_build_object('from', v_before, 'to', v_new_status, 'plan', v_plan, 'provider', p_provider, 'reason', nullif(left(p_data->>'reason', 300), '')));
  return jsonb_build_object('outcome', v_outcome, 'status', v_new_status);
end $$;

create or replace function private.admin_manual_subscription_impl(p_business uuid, p_plan text, p_status text, p_period_end timestamptz, p_reason text) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.platform_admin_check();
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'reason_required' using errcode = '23514'; end if;
  -- an admin's decision is the latest fact by definition: it is ordered after whatever the last event was
  return private.billing_apply_event('manual', gen_random_uuid()::text, 'subscription.updated',
    greatest(clock_timestamp(), coalesce((select last_event_at from public.subscriptions where business_id = p_business), '-infinity'::timestamptz) + interval '1 millisecond'), p_business,
    jsonb_build_object('planId', p_plan, 'status', p_status, 'currentPeriodEnd', p_period_end, 'reason', btrim(p_reason)));
end $$;

create or replace function private.entitlement_limit(p_business uuid, p_key text) returns int language sql stable security definer set search_path = '' as $$
  select case
    when o.business_id is not null then case when o.unlimited then null else coalesce(o.int_value, 0) end   -- an override that sets no number is a closed door, not an open one
    when f.plan_id is not null then f.int_value
    else 0 end
  from (select 1) x
  left join public.entitlement_overrides o on o.business_id = p_business and o.key = p_key and (o.expires_at is null or o.expires_at > now())
  left join public.subscriptions s on s.business_id = p_business
  left join public.plan_features f on f.plan_id = s.plan_id and f.key = p_key
$$;

-- the bulk page function is the export's data source: only managers whose plan includes the export may call it (a staff member cannot page through PostgREST around the audited route)
create or replace function public.owner_customers_page(p_business uuid, p_after uuid default null, p_limit int default 1000)
returns table (id uuid, full_name text, phone text, email text, notes text, created_at timestamptz, anonymized_at timestamptz,
               visits int, no_shows int, cancellations int, last_visit timestamptz, spent_cents bigint)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.full_name, c.phone, c.email, c.notes, c.created_at, c.anonymized_at,
         count(a.id) filter (where a.status = 'completed')::int,
         count(a.id) filter (where a.status = 'no_show')::int,
         count(a.id) filter (where a.status = 'cancelled_by_customer')::int,
         max(a.starts_at) filter (where a.status = 'completed'),
         coalesce(sum(a.price_cents) filter (where a.status = 'completed'), 0)::bigint
  from public.customers c
  left join public.appointments a on a.customer_id = c.id and a.business_id = c.business_id
  where c.business_id = p_business and (p_after is null or c.id > p_after)
    and private.is_member(p_business, 'admin') and private.entitlement_can(p_business, 'export')
  group by c.id
  order by c.id
  limit least(greatest(p_limit, 1), 2000)
$$;

-- invariants by grants: the system path can read these tables, and can change them only through the definer functions
revoke insert, update, delete, truncate on public.subscriptions, public.entitlement_overrides, public.billing_events, public.audit_log, public.platform_admins from service_role;
-- and the audit log cannot be emptied either (the row-level trigger covers UPDATE/DELETE, this covers TRUNCATE)
create function private.audit_no_truncate() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'audit_log is append-only' using errcode = '42501'; end $$;
create trigger audit_log_no_truncate before truncate on public.audit_log for each statement execute function private.audit_no_truncate();

-- outbox: a claim is a 5-minute lease (a worker that is slow keeps its event), a failure sets the retry backoff, and an event that failed 15 times stops being retried (it stays visible)
create or replace function private.claim_events(p_limit int default 10)
returns setof public.domain_events language plpgsql security definer set search_path = '' as $$
begin
  return query
  with picked as (
    select e.id from public.domain_events e
    where e.processed_at is null and e.available_at <= now() and e.attempts < 15
    order by e.created_at limit greatest(p_limit, 1)
    for update skip locked
  )
  update public.domain_events e
     set attempts = e.attempts + 1,
         available_at = now() + interval '5 minutes'
  from picked where e.id = picked.id
  returning e.*;
end $$;
create or replace function private.fail_event(p_id uuid, p_error text) returns void language sql security definer set search_path = '' as $$
  update public.domain_events set last_error = left(p_error, 500), available_at = now() + (least(power(2, attempts), 3600) * interval '1 second') where id = p_id
$$;

-- first close what the new rule would flag today (trigger functions and helpers that kept the default PUBLIC execute)
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.prosecdef
             and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
  loop execute format('revoke execute on function %s from public', f.sig); end loop;
end $$;
create or replace function private.lint_violations()
returns table (rule text, object_name text, detail text)
language sql
stable
set search_path = ''
as $$
  with ext_objs as (
    select objid from pg_catalog.pg_depend where deptype = 'e'
  ),
  tbl as (
    select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.oid not in (select objid from ext_objs)
  )
  -- RLS must be enabled on every public table
  select 'rls_disabled'::text, 'public.' || relname, 'ENABLE ROW LEVEL SECURITY missing'
  from tbl where not relrowsecurity
  union all
  -- ... and forced, so even the table owner is subject to policies
  select 'rls_not_forced', 'public.' || relname, 'FORCE ROW LEVEL SECURITY missing'
  from tbl where not relforcerowsecurity
  union all
  -- anon must have no table privileges at all
  select 'anon_table_grant', 'public.' || relname, 'role anon has privileges'
  from tbl
  where pg_catalog.has_table_privilege('anon', oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  union all
  -- tenant tables need a leading business_id index (docs/03 §5)
  select 'tenant_index_missing', 'public.' || t.relname, 'no index with leading business_id'
  from tbl t
  where exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = t.oid and a.attname = 'business_id' and not a.attisdropped
    )
    and not exists (
      select 1 from pg_catalog.pg_index i
      join pg_catalog.pg_attribute a2 on a2.attrelid = i.indrelid and a2.attnum = i.indkey[0]
      where i.indrelid = t.oid and a2.attname = 'business_id'
    )
  union all
  -- security definer functions must pin search_path (privilege-escalation vector)
  select 'definer_without_search_path', n.nspname || '.' || p.proname, 'SECURITY DEFINER without SET search_path'
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef and n.nspname in ('public', 'private')
    and p.oid not in (select objid from ext_objs)
    and not coalesce(exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'), false)
  union all
  -- security definer functions must not live in an API-exposed schema
  select 'definer_in_exposed_schema', n.nspname || '.' || p.proname, 'SECURITY DEFINER function in public'
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef and n.nspname = 'public' and p.oid not in (select objid from ext_objs)
  union all
  -- functions in public callable by anon become public RPCs
  select 'anon_function_execute', n.nspname || '.' || p.proname, 'role anon may EXECUTE'
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.oid not in (select objid from ext_objs)
    and pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
  union all
  -- a SECURITY DEFINER function in `private` must be callable only by the roles that are granted it, never by PUBLIC (it would run with owner rights for anyone who can reach it)
  select 'private_definer_public_execute', 'private.' || p.proname, 'SECURITY DEFINER function executable by PUBLIC'
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.prosecdef and p.oid not in (select objid from ext_objs)
    and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
  union all
  -- views must run with the caller's privileges so RLS still applies
  select 'view_without_security_invoker', 'public.' || c.relname, 'view lacks security_invoker=true'
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm') and c.oid not in (select objid from ext_objs)
    and not coalesce(c.reloptions @> array['security_invoker=true'], false);
$$;
