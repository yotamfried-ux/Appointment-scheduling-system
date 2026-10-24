-- Customers accept the terms of use and the privacy policy, and the acceptance is recorded (owner decision, 2026-10-24; docs/legal/breach-and-liability-brief.md section 1).
-- Each appointment and each waitlist entry created through the public API stores the versions the customer accepted and the time. The server never looks up whether an address
-- accepted before (no enumeration): it only validates the versions it receives (Zod, against lib/legal/config.ts) and stores them. The columns are nullable: rows made before this
-- migration and appointments the owner enters by hand have no acceptance. They are written by the existing booking / waitlist functions (new trailing parameters, default null).

alter table public.appointments
  add column terms_version text,
  add column privacy_version text,
  add column terms_accepted_at timestamptz;
alter table public.waitlist_entries
  add column terms_version text,
  add column privacy_version text,
  add column terms_accepted_at timestamptz;

drop function public.public_book_team(uuid, uuid, timestamptz, text, text, text, text, jsonb, text, text, uuid[], boolean);
drop function private.public_book_team(uuid, uuid, timestamptz, text, text, text, text, jsonb, text, text, uuid[], boolean);
create function private.public_book_team(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_email text, p_location text, p_intake jsonb, p_idem_key text, p_request_hash text,
                                         p_resources uuid[], p_chosen boolean, p_terms_version text default null, p_privacy_version text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses;
  s public.services;
  v_cands uuid[];
  v_res uuid;
  v_cust uuid;
  v_appt public.appointments;
  v_prior public.booking_idempotency;
  v_ref text;
  v_status text;
  v_tries int;
  v_override boolean;
  v_force_pending boolean := false;
  v_done boolean := false;
begin
  select * into b from public.businesses where id = p_business and published_at is not null;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;

  select * into v_prior from public.booking_idempotency where business_id = p_business and idem_key = p_idem_key;
  if found then
    if v_prior.request_hash <> p_request_hash then raise exception 'idempotency_reuse' using errcode = 'P0001'; end if;
    select * into v_appt from public.appointments where id = v_prior.appointment_id;
    return jsonb_build_object('replay', true, 'id', v_appt.id, 'reference', v_appt.reference, 'status', v_appt.status, 'startsAt', v_appt.starts_at, 'endsAt', v_appt.ends_at);
  end if;

  select * into s from public.services where id = p_service and business_id = p_business and active and capacity = 1;
  if not found then raise exception 'service_unavailable' using errcode = 'P0001'; end if;           -- BKG-10
  v_cands := private.team_candidates(p_business, p_service, p_starts_at, p_resources);
  if cardinality(v_cands) = 0 then raise exception 'slot_taken' using errcode = 'P0001'; end if;     -- nobody (still) able to take it
  if p_starts_at < now() + make_interval(mins => b.min_notice_minutes) then raise exception 'slot_in_past' using errcode = 'P0001'; end if;
  if p_starts_at > now() + make_interval(days => b.booking_horizon_days) then raise exception 'slot_too_far' using errcode = 'P0001'; end if;

  -- Identity is the e-mail address (BKG-05, Strix VULN-0008): an e-mail is required, and one customer exists per mailbox per business. A phone number typed on a public form no longer
  -- selects (or touches) anybody's record. An anonymous request never rewrites an existing customer; the phone and name of the first booking stay.
  if nullif(btrim(coalesce(p_email, '')), '') is null then raise exception 'invalid_input' using errcode = '23514'; end if;
  insert into public.customers (business_id, full_name, phone, email, email_key) values (p_business, btrim(p_full_name), p_phone, btrim(p_email), private.mailbox_key(p_email))
  on conflict (business_id, email_key) where email_key is not null do update set full_name = public.customers.full_name
  returning id, policy_override into v_cust, v_override;

  if (select count(*) from public.appointments where business_id = p_business and customer_id = v_cust and starts_at > now()
        and status in ('pending','confirmed','cancellation_requested')) >= 5 then
    raise exception 'booking_limit' using errcode = 'P0001';                                      -- BKG-07
  end if;

  if b.no_show_policy in ('block', 'require_approval') and not v_override
     and (select count(*) from public.appointments where business_id = p_business and customer_id = v_cust and status = 'no_show' and starts_at >= now() - interval '60 days') >= b.no_show_threshold then
    if b.no_show_policy = 'block' then raise exception 'customer_blocked' using errcode = 'P0001', detail = coalesce(b.block_message, ''); end if;
    v_force_pending := true;                                                                      -- BKG-08
  end if;

  v_status := case when v_force_pending or coalesce(s.requires_approval, b.requires_approval) then 'pending' else 'confirmed' end;   -- BKG-09 / BKG-08
  foreach v_res in array v_cands loop
    -- a live waitlist offer reserves ITS PERSON's slot (WLT-01/04, T10): skip to the next person
    if exists (select 1 from public.waitlist_offers o where o.resource_id = v_res and o.status = 'pending' and o.expires_at > now()
               and tstzrange(o.slot_starts_at, o.blocked_until, '[)') && tstzrange(p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes + s.buffer_minutes), '[)')) then
      continue;
    end if;
    v_tries := 0;
    loop
      v_ref := 'TR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      begin
        insert into public.appointments (business_id, resource_id, resource_chosen, service_id, customer_id, contact_email, terms_version, privacy_version, terms_accepted_at, reference, status, location, intake, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
        values (p_business, v_res, coalesce(p_chosen, false), s.id, v_cust, nullif(btrim(coalesce(p_email, '')), ''), p_terms_version, p_privacy_version, case when p_terms_version is not null then now() end, v_ref, v_status, coalesce(p_location, 'business'), coalesce(p_intake, '{}'::jsonb), p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes),
                p_starts_at + make_interval(mins => s.duration_minutes + s.buffer_minutes),
                jsonb_build_object('name', s.name, 'durationMinutes', s.duration_minutes, 'bufferMinutes', s.buffer_minutes, 'priceCents', s.price_cents), s.price_cents, s.currency)
        returning * into v_appt;
        v_done := true;
        exit;
      exception
        when exclusion_violation or deadlock_detected then exit;                                  -- this person is taken: try the next one
        when unique_violation then
          v_tries := v_tries + 1;
          if v_tries > 5 then raise; end if;                                                      -- reference collision: retry
      end;
    end loop;
    exit when v_done;
  end loop;
  if not v_done then raise exception 'slot_taken' using errcode = 'P0001'; end if;               -- BKG-02 → HTTP 409
  insert into public.booking_idempotency (business_id, idem_key, request_hash, appointment_id) values (p_business, p_idem_key, p_request_hash, v_appt.id);
  perform private.enqueue_event(p_business, 'AppointmentCreated', jsonb_build_object('appointmentId', v_appt.id), 'appt:' || v_appt.id::text);
  return jsonb_build_object('replay', false, 'id', v_appt.id, 'reference', v_appt.reference, 'status', v_appt.status, 'startsAt', v_appt.starts_at, 'endsAt', v_appt.ends_at, 'resourceId', v_appt.resource_id);
end $$;
create function public.public_book_team(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_email text, p_location text, p_intake jsonb, p_idem_key text, p_request_hash text, p_resources uuid[], p_chosen boolean, p_terms_version text default null, p_privacy_version text default null)
returns jsonb language sql security invoker set search_path = '' as $$ select private.public_book_team(p_business, p_service, p_starts_at, p_full_name, p_phone, p_email, p_location, p_intake, p_idem_key, p_request_hash, p_resources, p_chosen, p_terms_version, p_privacy_version) $$;
revoke all on function private.public_book_team(uuid, uuid, timestamptz, text, text, text, text, jsonb, text, text, uuid[], boolean, text, text), public.public_book_team(uuid, uuid, timestamptz, text, text, text, text, jsonb, text, text, uuid[], boolean, text, text) from public, anon, authenticated;
grant execute on function private.public_book_team(uuid, uuid, timestamptz, text, text, text, text, jsonb, text, text, uuid[], boolean, text, text), public.public_book_team(uuid, uuid, timestamptz, text, text, text, text, jsonb, text, text, uuid[], boolean, text, text) to service_role;

drop function public.waitlist_join(uuid, uuid, date, int, int, text, text, text, text);
drop function private.waitlist_join_impl(uuid, uuid, date, int, int, text, text, text, text);
create function private.waitlist_join_impl(p_business uuid, p_service uuid, p_date date, p_from int, p_to int, p_full_name text, p_phone text, p_email text, p_idem_hash text default null, p_terms_version text default null, p_privacy_version text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.businesses; s public.services; v_cust uuid; v_entry public.waitlist_entries; v_existing public.waitlist_entries;
begin
  select * into b from public.businesses where id = p_business and published_at is not null;
  if not found or not b.waitlist_enabled then raise exception 'not_found' using errcode = 'P0001'; end if;
  select * into s from public.services where id = p_service and business_id = p_business and active and capacity = 1;
  if not found then raise exception 'service_unavailable' using errcode = 'P0001'; end if;
  if nullif(btrim(coalesce(p_email, '')), '') is null then raise exception 'email_required' using errcode = '23514'; end if;       -- offers travel by e-mail
  if p_date < (now() at time zone b.timezone)::date or p_date > (now() at time zone b.timezone)::date + b.booking_horizon_days then raise exception 'date_out_of_range' using errcode = 'P0001'; end if;
  insert into public.customers (business_id, full_name, phone, email, email_key) values (p_business, btrim(p_full_name), p_phone, btrim(p_email), private.mailbox_key(p_email))
  on conflict (business_id, email_key) where email_key is not null do update set full_name = public.customers.full_name
  returning id into v_cust;
  select * into v_existing from public.waitlist_entries where business_id = p_business and customer_id = v_cust and service_id = p_service and on_date = p_date and status in ('waiting','offered');
  if found then   -- idempotent; but the caller gets to manage the entry only if it can prove it created it (the same idempotency key), not merely by knowing the phone
    return jsonb_build_object('replay', true, 'id', v_existing.id, 'status', v_existing.status, 'owner', p_idem_hash is not null and v_existing.idem_hash = p_idem_hash);
  end if;
  if (select count(*) from public.waitlist_entries where business_id = p_business and customer_id = v_cust and status in ('waiting','offered')) >= 3 then
    raise exception 'waitlist_limit' using errcode = 'P0001';                                                                          -- WLT-08
  end if;
  insert into public.waitlist_entries (business_id, service_id, customer_id, contact_email, idem_hash, terms_version, privacy_version, terms_accepted_at, on_date, from_minute, to_minute) values (p_business, p_service, v_cust, btrim(p_email), p_idem_hash, p_terms_version, p_privacy_version, case when p_terms_version is not null then now() end, p_date, p_from, p_to) returning * into v_entry;
  return jsonb_build_object('replay', false, 'owner', true, 'id', v_entry.id, 'status', v_entry.status);
end $$;
create function public.waitlist_join(p_business uuid, p_service uuid, p_date date, p_from int, p_to int, p_full_name text, p_phone text, p_email text, p_idem_hash text default null, p_terms_version text default null, p_privacy_version text default null)
  returns jsonb language sql security invoker set search_path = '' as $$ select private.waitlist_join_impl(p_business, p_service, p_date, p_from, p_to, p_full_name, p_phone, p_email, p_idem_hash, p_terms_version, p_privacy_version) $$;
revoke all on function private.waitlist_join_impl(uuid, uuid, date, int, int, text, text, text, text, text, text), public.waitlist_join(uuid, uuid, date, int, int, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function private.waitlist_join_impl(uuid, uuid, date, int, int, text, text, text, text, text, text), public.waitlist_join(uuid, uuid, date, int, int, text, text, text, text, text, text) to service_role;
