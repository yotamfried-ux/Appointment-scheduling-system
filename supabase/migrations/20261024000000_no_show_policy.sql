-- Stage 12 / BKG-08: a business can warn about, require approval for, or block customers with repeated no-shows (rolling 60 days).
alter table public.businesses
  add column no_show_policy text not null default 'off' check (no_show_policy in ('off','warn','require_approval','block')),
  add column no_show_threshold int not null default 3 check (no_show_threshold between 1 and 20),
  add column block_message text check (block_message is null or char_length(block_message) <= 300);
alter table public.customers add column policy_override boolean not null default false;
grant update (no_show_policy, no_show_threshold, block_message) on public.businesses to authenticated;

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

-- the owner clears (or restores) the policy for one customer; the change is audited
create function private.set_customer_policy_override_impl(p_customer uuid, p_override boolean) returns void language plpgsql security definer set search_path = '' as $$
declare c public.customers;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into c from public.customers where id = p_customer;
  if not found or not private.is_member(c.business_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.customers set policy_override = coalesce(p_override, false) where id = p_customer;
  perform private.audit_write(c.business_id, 'customer.policy_override', 'customer', p_customer::text, jsonb_build_object('override', coalesce(p_override, false)));
end $$;
create function public.set_customer_policy_override(p_customer uuid, p_override boolean) returns void language sql security invoker set search_path = '' as $$ select private.set_customer_policy_override_impl(p_customer, p_override) $$;
revoke all on function private.set_customer_policy_override_impl(uuid, boolean), public.set_customer_policy_override(uuid, boolean) from public, anon;
grant execute on function private.set_customer_policy_override_impl(uuid, boolean), public.set_customer_policy_override(uuid, boolean) to authenticated;
