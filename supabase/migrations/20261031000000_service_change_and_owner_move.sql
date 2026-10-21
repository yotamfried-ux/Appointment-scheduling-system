-- Stage 13: RSC-03 (a customer may change the service when moving, if the business allows it) and RSC-04 (the owner moves a booking; the customer is told and can always decline).
alter table public.businesses add column reschedule_service_change boolean not null default false;
grant update (reschedule_service_change) on public.businesses to authenticated;
alter table public.appointments add column moved_by_business_at timestamptz;

create or replace function private.appointments_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_anon boolean := coalesce(current_setting('app.anonymizing', true), '') = 'on';
        v_move boolean := coalesce(current_setting('app.rescheduling', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.resources r where r.id = new.resource_id and r.business_id = new.business_id)
       or not exists (select 1 from public.services s where s.id = new.service_id and s.business_id = new.business_id)
       or not exists (select 1 from public.customers c where c.id = new.customer_id and c.business_id = new.business_id) then
      raise exception 'tenant_mismatch' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.business_id <> old.business_id or new.resource_id <> old.resource_id or new.customer_id <> old.customer_id or (not v_move and new.service_id <> old.service_id)
     or (not v_move and (new.starts_at <> old.starts_at or new.ends_at <> old.ends_at or new.blocked_until <> old.blocked_until or new.rescheduled_count <> old.rescheduled_count))
     or new.reference <> old.reference
     or (not v_move and (new.service_snapshot <> old.service_snapshot or new.price_cents <> old.price_cents or new.out_of_availability <> old.out_of_availability))
     or new.location <> old.location or new.source <> old.source
     or (not v_anon and (new.intake <> old.intake or new.owner_note is distinct from old.owner_note))
     or (new.contact_email is distinct from old.contact_email and not (v_anon and new.contact_email is null)) then
    raise exception 'appointment_immutable' using errcode = 'P0001';
  end if;
  if new.status <> old.status and not (
       (old.status = 'pending' and new.status in ('confirmed','cancelled_by_business','cancelled_by_customer'))
    or (old.status = 'confirmed' and new.status in ('completed','no_show','cancelled_by_customer','cancelled_by_business','cancellation_requested'))
    or (old.status = 'cancellation_requested' and new.status in ('cancelled_by_customer','cancelled_by_business','confirmed'))
    or (old.status = 'completed' and new.status = 'no_show')
    or (old.status = 'no_show' and new.status = 'completed')
    or (v_move and old.status = 'confirmed' and new.status = 'pending')     -- a moved appointment of a service that needs approval is decided again
  ) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop function public.public_reschedule(uuid, timestamptz);
drop function private.public_reschedule(uuid, timestamptz);
create function private.public_reschedule(p_id uuid, p_new_start timestamptz, p_new_service uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.appointments; b public.businesses; s public.services;
  v_old_start timestamptz; v_old_blocked timestamptz; v_changed boolean := false; v_dur int; v_buf int; v_status text;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  select * into b from public.businesses where id = a.business_id;
  if a.status not in ('pending','confirmed') then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
  if now() > a.starts_at - make_interval(hours => b.cancel_until_hours) then raise exception 'too_late' using errcode = 'P0001'; end if;   -- RSC-02: the same window as cancelling
  if a.rescheduled_count >= 3 then raise exception 'reschedule_limit' using errcode = 'P0001'; end if;
  if p_new_service is not null and p_new_service <> a.service_id then
    if not b.reschedule_service_change then raise exception 'service_change_not_allowed' using errcode = 'P0001'; end if;   -- RSC-03: only when the business allows it
    select * into s from public.services where id = p_new_service and business_id = a.business_id and active and capacity = 1;
    v_changed := true;
  else
    select * into s from public.services where id = a.service_id and active and capacity = 1;
  end if;
  if not found then raise exception 'service_unavailable' using errcode = 'P0001'; end if;
  if p_new_start = a.starts_at then raise exception 'same_slot' using errcode = 'P0001'; end if;
  if p_new_start < now() + make_interval(mins => b.min_notice_minutes) then raise exception 'slot_in_past' using errcode = 'P0001'; end if;
  if p_new_start > now() + make_interval(days => b.booking_horizon_days) then raise exception 'slot_too_far' using errcode = 'P0001'; end if;
  if v_changed then v_dur := s.duration_minutes; v_buf := s.buffer_minutes; else v_dur := (a.service_snapshot ->> 'durationMinutes')::int; v_buf := (a.service_snapshot ->> 'bufferMinutes')::int; end if;   -- a new service brings its own length; otherwise the booked one is kept
  if exists (select 1 from public.waitlist_offers o where o.business_id = a.business_id and o.status = 'pending' and o.expires_at > now()
             and tstzrange(o.slot_starts_at, o.blocked_until, '[)') && tstzrange(p_new_start, p_new_start + make_interval(mins => v_dur + v_buf), '[)')) then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;
  v_old_start := a.starts_at; v_old_blocked := a.blocked_until;
  v_status := case when a.status = 'confirmed' and coalesce(s.requires_approval, b.requires_approval) then 'pending' else a.status end;
  perform set_config('app.rescheduling', 'on', true);
  begin
    update public.appointments set starts_at = p_new_start, ends_at = p_new_start + make_interval(mins => v_dur), blocked_until = p_new_start + make_interval(mins => v_dur + v_buf),
           rescheduled_count = rescheduled_count + 1, status = v_status,
           service_id = s.id,
           service_snapshot = case when v_changed then jsonb_build_object('name', s.name, 'durationMinutes', s.duration_minutes, 'bufferMinutes', s.buffer_minutes, 'priceCents', s.price_cents) else service_snapshot end,
           price_cents = case when v_changed then s.price_cents else price_cents end
     where id = p_id returning * into a;
  exception when exclusion_violation then raise exception 'slot_taken' using errcode = 'P0001';    -- the old slot stays: the update did not happen
  end;
  perform set_config('app.rescheduling', 'off', true);
  -- one message per kind for the latest move; earlier unsent reminders belong to the old time
  delete from public.notification_log where appointment_id = p_id and type in ('booking_rescheduled', 'owner_customer_rescheduled', 'reminder') and status in ('queued', 'skipped', 'sent');
  perform private.enqueue_event(a.business_id, 'AppointmentRescheduled', jsonb_build_object('appointmentId', a.id, 'previousStartsAt', v_old_start), 'resched:' || a.id::text || ':' || a.rescheduled_count::text);
  perform private.waitlist_offer_for_slot(a.business_id, v_old_start, v_old_blocked);                -- the slot just freed goes to the waitlist (WLT-01)
  return jsonb_build_object('id', a.id, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at, 'rescheduledCount', a.rescheduled_count);
end $$;
create function public.public_reschedule(p_id uuid, p_new_start timestamptz, p_new_service uuid default null) returns jsonb language sql security invoker set search_path = '' as $$ select private.public_reschedule(p_id, p_new_start, p_new_service) $$;
revoke all on function private.public_reschedule(uuid, timestamptz, uuid), public.public_reschedule(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function private.public_reschedule(uuid, timestamptz, uuid), public.public_reschedule(uuid, timestamptz, uuid) to service_role;

create or replace function private.public_cancel(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.appointments; b public.businesses;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  select * into b from public.businesses where id = a.business_id;
  if a.status not in ('pending','confirmed') then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
  -- RSC-04: a time the BUSINESS chose can always be declined
  if a.moved_by_business_at is null and now() > a.starts_at - make_interval(hours => b.cancel_until_hours) then raise exception 'too_late' using errcode = 'P0001'; end if;
  update public.appointments set status = 'cancelled_by_customer', cancelled_at = now() where id = p_id;
  perform private.enqueue_event(a.business_id, 'AppointmentCancelled', jsonb_build_object('appointmentId', a.id, 'by', 'customer'), 'cancel:' || a.id::text);
  perform private.waitlist_offer_for_slot(a.business_id, a.starts_at, a.blocked_until);
  return jsonb_build_object('id', a.id, 'status', 'cancelled_by_customer');
end $$;

-- RSC-04: the owner (admin or owner role) moves a booking to a free time; same row, same link, the customer is told and may decline without any window
create function private.owner_move_appointment_impl(p_id uuid, p_new_start timestamptz, p_out_of_availability boolean default false) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.appointments; v_old_start timestamptz; v_old_blocked timestamptz; v_dur int; v_buf int;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into a from public.appointments where id = p_id for update;
  if not found or not private.is_member(a.business_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if a.status not in ('pending', 'confirmed') then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
  if p_new_start <= now() then raise exception 'slot_in_past' using errcode = 'P0001'; end if;
  if p_new_start = a.starts_at then raise exception 'same_slot' using errcode = 'P0001'; end if;
  v_dur := (a.service_snapshot ->> 'durationMinutes')::int; v_buf := (a.service_snapshot ->> 'bufferMinutes')::int;
  v_old_start := a.starts_at; v_old_blocked := a.blocked_until;
  perform set_config('app.rescheduling', 'on', true);
  begin
    update public.appointments set starts_at = p_new_start, ends_at = p_new_start + make_interval(mins => v_dur), blocked_until = p_new_start + make_interval(mins => v_dur + v_buf),
           moved_by_business_at = now(), attendance_confirmed_at = null, out_of_availability = coalesce(p_out_of_availability, false) where id = p_id returning * into a;
  exception when exclusion_violation or deadlock_detected then raise exception 'slot_taken' using errcode = 'P0001';
  end;
  perform set_config('app.rescheduling', 'off', true);
  delete from public.notification_log where appointment_id = p_id and type in ('booking_moved_by_business', 'reminder', 'owner_unconfirmed') and status in ('queued', 'skipped', 'sent');
  perform private.enqueue_event(a.business_id, 'AppointmentMovedByBusiness', jsonb_build_object('appointmentId', a.id, 'previousStartsAt', v_old_start), 'moved:' || a.id::text || ':' || extract(epoch from now())::text);
  perform private.audit_write(a.business_id, 'appointment.moved', 'appointment', a.id::text, jsonb_build_object('from', v_old_start, 'to', a.starts_at));
  perform private.waitlist_offer_for_slot(a.business_id, v_old_start, v_old_blocked);
  return jsonb_build_object('id', a.id, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at);
end $$;
create function public.owner_move_appointment(p_id uuid, p_new_start timestamptz, p_out_of_availability boolean default false) returns jsonb language sql security invoker set search_path = '' as $$ select private.owner_move_appointment_impl(p_id, p_new_start, p_out_of_availability) $$;
revoke all on function private.owner_move_appointment_impl(uuid, timestamptz, boolean), public.owner_move_appointment(uuid, timestamptz, boolean) from public, anon;
grant execute on function private.owner_move_appointment_impl(uuid, timestamptz, boolean), public.owner_move_appointment(uuid, timestamptz, boolean) to authenticated;

alter table public.notification_log drop constraint notification_log_type_check;
alter table public.notification_log add constraint notification_log_type_check check (type in
  ('booking_received','booking_confirmed','booking_declined','booking_cancelled_by_business','booking_cancelled_by_customer','reminder','owner_new_request','owner_customer_cancelled',
   'waitlist_offer','waitlist_offer_expired','booking_rescheduled','owner_customer_rescheduled','owner_unconfirmed','owner_digest','booking_moved_by_business'));

create or replace function private.public_get_appointment(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'reference', a.reference, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at,
    'serviceName', a.service_snapshot->>'name', 'serviceId', a.service_id, 'priceMode', (select s.price_mode from public.services s where s.id = a.service_id), 'priceCents', a.price_cents,
    'businessName', b.name, 'businessSlug', b.slug, 'timezone', b.timezone,
    'cancelUntil', case when a.moved_by_business_at is not null then a.starts_at else a.starts_at - make_interval(hours => b.cancel_until_hours) end,
    'updatedAt', a.updated_at, 'rescheduledCount', a.rescheduled_count,
    'attendanceConfirmedAt', a.attendance_confirmed_at, 'serviceChangeAllowed', b.reschedule_service_change, 'movedByBusinessAt', a.moved_by_business_at)
  from public.appointments a join public.businesses b on b.id = a.business_id where a.id = p_id
$$;
