-- Stage 12 / RSC-01, RSC-02: a customer moves their appointment from the private link. One transaction, same row.
alter table public.appointments add column rescheduled_count int not null default 0 check (rescheduled_count between 0 and 3);

-- the guard lets the time columns change only inside private.public_reschedule (flag set with set_config(..., true) = this transaction)
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
  if new.business_id <> old.business_id or new.resource_id <> old.resource_id or new.service_id <> old.service_id or new.customer_id <> old.customer_id
     or (not v_move and (new.starts_at <> old.starts_at or new.ends_at <> old.ends_at or new.blocked_until <> old.blocked_until or new.rescheduled_count <> old.rescheduled_count))
     or new.reference <> old.reference
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
    or (old.status = 'completed' and new.status = 'no_show')
    or (old.status = 'no_show' and new.status = 'completed')
    or (v_move and old.status = 'confirmed' and new.status = 'pending')     -- a moved appointment of a service that needs approval is decided again
  ) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  return new;
end $$;

alter table public.notification_log drop constraint notification_log_type_check;
alter table public.notification_log add constraint notification_log_type_check check (type in
  ('booking_received','booking_confirmed','booking_declined','booking_cancelled_by_business','booking_cancelled_by_customer','reminder','owner_new_request','owner_customer_cancelled',
   'waitlist_offer','waitlist_offer_expired','booking_rescheduled','owner_customer_rescheduled'));

create function private.public_reschedule(p_id uuid, p_new_start timestamptz) returns jsonb language plpgsql security definer set search_path = '' as $$
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

create or replace function private.public_get_appointment(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'reference', a.reference, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at,
    'serviceName', a.service_snapshot->>'name', 'serviceId', a.service_id, 'priceCents', a.price_cents, 'businessName', b.name, 'businessSlug', b.slug, 'timezone', b.timezone,
    'cancelUntil', a.starts_at - make_interval(hours => b.cancel_until_hours), 'updatedAt', a.updated_at, 'rescheduledCount', a.rescheduled_count)
  from public.appointments a join public.businesses b on b.id = a.business_id where a.id = p_id
$$;

create function public.public_reschedule(p_id uuid, p_new_start timestamptz) returns jsonb language sql security invoker set search_path = '' as $$ select private.public_reschedule(p_id, p_new_start) $$;
revoke all on function private.public_reschedule(uuid, timestamptz), public.public_reschedule(uuid, timestamptz) from public, anon, authenticated;
grant execute on function private.public_reschedule(uuid, timestamptz), public.public_reschedule(uuid, timestamptz) to service_role;
