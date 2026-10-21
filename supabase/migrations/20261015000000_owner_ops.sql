-- Stage 5: owner operations. Owners work through RLS (their own JWT), never through the system key.
-- Adds manual appointments (AVL-09/10), and tightens complete / no_show to appointments that have started.

alter table public.appointments
  add column source text not null default 'online' check (source in ('online','manual')),
  add column out_of_availability boolean not null default false,
  add column owner_note text check (owner_note is null or char_length(owner_note) <= 200);

-- Guard: the new facts about how an appointment came to be are as immutable as the rest of its core.
create or replace function private.appointments_guard() returns trigger language plpgsql set search_path = '' as $$
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
     or new.service_snapshot <> old.service_snapshot or new.price_cents <> old.price_cents or new.intake <> old.intake or new.location <> old.location
     or new.source <> old.source or new.out_of_availability <> old.out_of_availability or new.owner_note is distinct from old.owner_note then
    raise exception 'appointment_immutable' using errcode = 'P0001';
  end if;
  if new.status <> old.status and not (
       (old.status = 'pending' and new.status in ('confirmed','cancelled_by_business','cancelled_by_customer'))
    or (old.status = 'confirmed' and new.status in ('completed','no_show','cancelled_by_customer','cancelled_by_business','cancellation_requested'))
    or (old.status = 'cancellation_requested' and new.status in ('cancelled_by_customer','cancelled_by_business','confirmed'))
  ) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- A visit can only be marked done / missed once it has begun.
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
  return jsonb_build_object('id', p_id, 'status', v_to);
end $$;

-- Manual appointment (walk-in, phone call). Staff may book anywhere, even outside opening hours; overlaps stay impossible (EXCLUDE).
create function private.create_manual_appointment_impl(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_note text, p_out_of_availability boolean)
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
  on conflict (business_id, phone) do update set full_name = excluded.full_name
  returning id into v_cust;

  loop
    v_ref := 'TR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, source, out_of_availability, owner_note, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
      values (p_business, v_res, s.id, v_cust, v_ref, 'confirmed', 'manual', coalesce(p_out_of_availability, false), nullif(btrim(coalesce(p_note, '')), ''),
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
revoke all on function private.create_manual_appointment_impl(uuid, uuid, timestamptz, text, text, text, boolean) from public, anon;
grant execute on function private.create_manual_appointment_impl(uuid, uuid, timestamptz, text, text, text, boolean) to authenticated;

create function public.create_manual_appointment(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_note text, p_out_of_availability boolean)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.create_manual_appointment_impl(p_business, p_service, p_starts_at, p_full_name, p_phone, p_note, p_out_of_availability)
$$;
revoke all on function public.create_manual_appointment(uuid, uuid, timestamptz, text, text, text, boolean) from public, anon;
grant execute on function public.create_manual_appointment(uuid, uuid, timestamptz, text, text, text, boolean) to authenticated;
