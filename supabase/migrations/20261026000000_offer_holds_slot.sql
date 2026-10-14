-- Stage 12 (found by the user-journey simulation): the offer e-mail promises that the slot is kept for the person offered it, but nothing kept it —
-- the public booking page could take the slot in the meantime. A live (pending, unexpired) offer now reserves its slot everywhere the public can book or move.
create or replace function private.public_busy(p_business uuid, p_from timestamptz, p_to timestamptz)
returns table (starts_at timestamptz, blocked_until timestamptz) language sql stable security definer set search_path = '' as $$
  select a.starts_at, a.blocked_until from public.appointments a
  where a.business_id = p_business and a.status in ('pending','confirmed','cancellation_requested')
    and a.starts_at < p_to and a.blocked_until > p_from
  union all
  select o.slot_starts_at, o.blocked_until from public.waitlist_offers o
  where o.business_id = p_business and o.status = 'pending' and o.expires_at > now()
    and o.slot_starts_at < p_to and o.blocked_until > p_from
$$;

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
  v_override boolean;
  v_force_pending boolean := false;
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
  returning id, policy_override into v_cust, v_override;

  -- BKG-07: bounded number of future active appointments per customer.
  if (select count(*) from public.appointments where business_id = p_business and customer_id = v_cust and starts_at > now()
        and status in ('pending','confirmed','cancellation_requested')) >= 5 then
    raise exception 'booking_limit' using errcode = 'P0001';
  end if;

  -- BKG-08: a customer with too many recent no-shows is handled by the business' own policy (the owner can clear it per customer)
  if b.no_show_policy in ('block', 'require_approval') and not v_override
     and (select count(*) from public.appointments where business_id = p_business and customer_id = v_cust and status = 'no_show' and starts_at >= now() - interval '60 days') >= b.no_show_threshold then
    if b.no_show_policy = 'block' then raise exception 'customer_blocked' using errcode = 'P0001', detail = coalesce(b.block_message, ''); end if;
    v_force_pending := true;
  end if;

  -- a live waitlist offer reserves its slot: the public cannot take it while the offered person decides (WLT-01/04; the owner can still override by hand)
  if exists (select 1 from public.waitlist_offers o where o.business_id = p_business and o.status = 'pending' and o.expires_at > now()
             and tstzrange(o.slot_starts_at, o.blocked_until, '[)') && tstzrange(p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes + s.buffer_minutes), '[)')) then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;
  v_status := case when v_force_pending or coalesce(s.requires_approval, b.requires_approval) then 'pending' else 'confirmed' end;   -- BKG-09 / BKG-08
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

create or replace function private.public_reschedule(p_id uuid, p_new_start timestamptz) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.appointments; b public.businesses; s public.services;
  v_old_start timestamptz; v_old_blocked timestamptz; v_dur int; v_buf int; v_status text;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  select * into b from public.businesses where id = a.business_id;
  if a.status not in ('pending','confirmed') then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
  if now() > a.starts_at - make_interval(hours => b.cancel_until_hours) then raise exception 'too_late' using errcode = 'P0001'; end if;   -- RSC-02: the same window as cancelling
  if a.rescheduled_count >= 3 then raise exception 'reschedule_limit' using errcode = 'P0001'; end if;
  select * into s from public.services where id = a.service_id and active and capacity = 1;
  if not found then raise exception 'service_unavailable' using errcode = 'P0001'; end if;
  if p_new_start = a.starts_at then raise exception 'same_slot' using errcode = 'P0001'; end if;
  if p_new_start < now() + make_interval(mins => b.min_notice_minutes) then raise exception 'slot_in_past' using errcode = 'P0001'; end if;
  if p_new_start > now() + make_interval(days => b.booking_horizon_days) then raise exception 'slot_too_far' using errcode = 'P0001'; end if;
  v_dur := (a.service_snapshot ->> 'durationMinutes')::int;                  -- RSC-03: the booked duration is kept
  v_buf := (a.service_snapshot ->> 'bufferMinutes')::int;
  if exists (select 1 from public.waitlist_offers o where o.business_id = a.business_id and o.status = 'pending' and o.expires_at > now()
             and tstzrange(o.slot_starts_at, o.blocked_until, '[)') && tstzrange(p_new_start, p_new_start + make_interval(mins => v_dur + v_buf), '[)')) then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;
  v_old_start := a.starts_at; v_old_blocked := a.blocked_until;
  v_status := case when a.status = 'confirmed' and coalesce(s.requires_approval, b.requires_approval) then 'pending' else a.status end;
  perform set_config('app.rescheduling', 'on', true);
  begin
    update public.appointments set starts_at = p_new_start, ends_at = p_new_start + make_interval(mins => v_dur), blocked_until = p_new_start + make_interval(mins => v_dur + v_buf),
           rescheduled_count = rescheduled_count + 1, status = v_status where id = p_id returning * into a;
  exception when exclusion_violation then raise exception 'slot_taken' using errcode = 'P0001';    -- the old slot stays: the update did not happen
  end;
  perform set_config('app.rescheduling', 'off', true);
  -- one message per kind for the latest move; earlier unsent reminders belong to the old time
  delete from public.notification_log where appointment_id = p_id and type in ('booking_rescheduled', 'owner_customer_rescheduled', 'reminder') and status in ('queued', 'skipped', 'sent');
  perform private.enqueue_event(a.business_id, 'AppointmentRescheduled', jsonb_build_object('appointmentId', a.id, 'previousStartsAt', v_old_start), 'resched:' || a.id::text || ':' || a.rescheduled_count::text);
  perform private.waitlist_offer_for_slot(a.business_id, v_old_start, v_old_blocked);                -- the slot just freed goes to the waitlist (WLT-01)
  return jsonb_build_object('id', a.id, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at, 'rescheduledCount', a.rescheduled_count);
end $$;
