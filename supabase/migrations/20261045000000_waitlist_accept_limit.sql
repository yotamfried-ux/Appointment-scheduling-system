-- Accepting a waitlist offer respects the same per-customer limit of future appointments as booking directly (BKG-07). See the note in the function.
create or replace function private.waitlist_accept_impl(p_offer uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.waitlist_offers; e public.waitlist_entries; b public.businesses; s public.services; v_appt public.appointments; v_ref text; v_status text; v_tries int := 0;
begin
  select * into o from public.waitlist_offers where id = p_offer for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if o.status <> 'pending' then return jsonb_build_object('outcome', 'not_pending', 'status', o.status); end if;
  select * into e from public.waitlist_entries where id = o.entry_id for update;
  if o.expires_at <= now() then
    update public.waitlist_offers set status = 'expired', resolved_at = now() where id = o.id;
    update public.waitlist_entries set status = 'waiting' where id = e.id and status = 'offered';
    perform private.notif_enqueue_offer(o.id, 'waitlist_offer_expired');
    perform private.waitlist_offer_for_slot(o.business_id, o.slot_starts_at, o.freed_until, null, false, o.resource_id);
    return jsonb_build_object('outcome', 'expired');
  end if;
  -- Strix (2026-10-22): the direct booking path stops at 5 future active appointments per customer (BKG-07); accepting an offer did not, so one customer could hold more.
  -- The offer stays pending (the customer can cancel an appointment and accept again); the application says why.
  if (select count(*) from public.appointments where business_id = o.business_id and customer_id = e.customer_id and starts_at > now()
        and status in ('pending','confirmed','cancellation_requested')) >= 5 then
    return jsonb_build_object('outcome', 'limit');
  end if;
  select * into b from public.businesses where id = o.business_id;
  select * into s from public.services where id = e.service_id;
  v_status := case when coalesce(s.requires_approval, b.requires_approval) then 'pending' else 'confirmed' end;
  loop
    v_ref := 'TR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.appointments (business_id, resource_id, service_id, customer_id, contact_email, reference, status, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
      values (o.business_id, o.resource_id, s.id, e.customer_id, e.contact_email, v_ref, v_status, o.slot_starts_at, o.slot_ends_at, o.blocked_until,
              jsonb_build_object('name', s.name, 'durationMinutes', s.duration_minutes, 'bufferMinutes', s.buffer_minutes, 'priceCents', s.price_cents), s.price_cents, s.currency)
      returning * into v_appt;
      exit;
    exception
      when exclusion_violation or deadlock_detected then
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
