-- Customer identity by e-mail instead of phone (owner decision, 2026-10-23; Strix VULN-0008 / 0013 / 0016 / 0004).
-- A phone number typed on a public form proves nothing, so it no longer selects a customer: anyone who knew a number could use up that customer's booking and waitlist limits.
-- One customer per mailbox per business now (the key ignores +tags and, for Gmail, dots, like the e-mail rate limit does), and the address is where the confirmation goes, which is the
-- groundwork for verifying it by a link in a next step. The phone stays on the record as contact data (not unique any more). Owner-entered customers (walk-ins) are still found by phone.
-- Existing rows: keyed by their stored address when they have one (the oldest wins if two collapse to the same mailbox); customers without an address keep working as before.

create function private.mailbox_key(p_email text) returns text language plpgsql immutable set search_path = '' as $$
declare
  e text := lower(btrim(coalesce(p_email, '')));
  at_pos int;
  lp text;
  dom text;
begin
  if e = '' then return null; end if;
  at_pos := length(e) - strpos(reverse(e), '@') + 1;
  if strpos(e, '@') = 0 or at_pos < 2 then return e; end if;
  lp := substr(e, 1, at_pos - 1);
  dom := substr(e, at_pos + 1);
  lp := split_part(lp, '+', 1);
  if dom in ('gmail.com', 'googlemail.com') then dom := 'gmail.com'; lp := replace(lp, '.', ''); end if;
  return lp || '@' || dom;
end $$;
revoke all on function private.mailbox_key(text) from public, anon, authenticated;

alter table public.customers add column email_key text;

create function private.customers_email_key() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.email_key := private.mailbox_key(new.email);
  return new;
end $$;
revoke all on function private.customers_email_key() from public, anon, authenticated;
create trigger customers_email_key before insert or update of email on public.customers for each row execute function private.customers_email_key();

update public.customers c set email_key = k.key
from (select id, private.mailbox_key(email) as key, row_number() over (partition by business_id, private.mailbox_key(email) order by created_at, id) as rn from public.customers where email is not null) k
where c.id = k.id and k.rn = 1 and k.key is not null;

create unique index customers_email_key_uidx on public.customers (business_id, email_key) where email_key is not null;
alter table public.customers drop constraint customers_business_id_phone_key;
create index customers_phone_idx on public.customers (business_id, phone);

create or replace function private.public_book_team(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_email text, p_location text, p_intake jsonb, p_idem_key text, p_request_hash text,
                                         p_resources uuid[], p_chosen boolean)
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
        insert into public.appointments (business_id, resource_id, resource_chosen, service_id, customer_id, contact_email, reference, status, location, intake, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
        values (p_business, v_res, coalesce(p_chosen, false), s.id, v_cust, nullif(btrim(coalesce(p_email, '')), ''), v_ref, v_status, coalesce(p_location, 'business'), coalesce(p_intake, '{}'::jsonb), p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes),
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

create or replace function private.waitlist_join_impl(p_business uuid, p_service uuid, p_date date, p_from int, p_to int, p_full_name text, p_phone text, p_email text, p_idem_hash text default null)
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
  insert into public.waitlist_entries (business_id, service_id, customer_id, contact_email, idem_hash, on_date, from_minute, to_minute) values (p_business, p_service, v_cust, btrim(p_email), p_idem_hash, p_date, p_from, p_to) returning * into v_entry;
  return jsonb_build_object('replay', false, 'owner', true, 'id', v_entry.id, 'status', v_entry.status);
end $$;

create or replace function private.create_manual_appointment_team(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_note text, p_out_of_availability boolean, p_resource uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.services;
  v_cands uuid[];
  v_res uuid;
  v_cust uuid;
  v_appt public.appointments;
  v_ref text;
  v_tries int;
  v_done boolean := false;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not private.is_member(p_business, 'staff') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from public.services where id = p_service and business_id = p_business and active and capacity = 1;
  if not found then raise exception 'service_unavailable' using errcode = 'P0001'; end if;
  if p_resource is not null and not exists (select 1 from public.resources r where r.id = p_resource and r.business_id = p_business) then
    raise exception 'resource_mismatch' using errcode = 'P0001';
  end if;
  v_cands := private.team_candidates(p_business, p_service, p_starts_at, case when p_resource is null then null else array[p_resource] end);
  if cardinality(v_cands) = 0 then raise exception 'service_unavailable' using errcode = 'P0001'; end if;
  if p_starts_at < now() - interval '24 hours' then raise exception 'slot_in_past' using errcode = 'P0001'; end if;
  if p_starts_at > now() + interval '400 days' then raise exception 'slot_too_far' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_full_name, ''))) < 2 or char_length(p_full_name) > 80 then raise exception 'invalid_name' using errcode = '23514'; end if;

  -- The owner identifies a customer by the phone he typed (he is trusted, and a walk-in may have no e-mail): the oldest live record with that number, else a new one.
  select id into v_cust from public.customers where business_id = p_business and phone = p_phone and anonymized_at is null order by created_at, id limit 1;
  if v_cust is null then
    insert into public.customers (business_id, full_name, phone) values (p_business, btrim(p_full_name), p_phone) returning id into v_cust;
  end if;

  foreach v_res in array v_cands loop
    v_tries := 0;
    loop
      v_ref := 'TR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      begin
        insert into public.appointments (business_id, resource_id, resource_chosen, service_id, customer_id, contact_email, reference, status, source, out_of_availability, owner_note, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
        values (p_business, v_res, p_resource is not null, s.id, v_cust, (select email from public.customers where id = v_cust), v_ref, 'confirmed', 'manual', coalesce(p_out_of_availability, false), nullif(btrim(coalesce(p_note, '')), ''),
                p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes), p_starts_at + make_interval(mins => s.duration_minutes + s.buffer_minutes),
                jsonb_build_object('name', s.name, 'durationMinutes', s.duration_minutes, 'bufferMinutes', s.buffer_minutes, 'priceCents', s.price_cents), s.price_cents, s.currency)
        returning * into v_appt;
        v_done := true;
        exit;
      exception
        when exclusion_violation or deadlock_detected then exit;
        when unique_violation then
          v_tries := v_tries + 1;
          if v_tries > 5 then raise; end if;
      end;
    end loop;
    exit when v_done;
  end loop;
  if not v_done then raise exception 'slot_taken' using errcode = 'P0001'; end if;
  perform private.audit_write(p_business, 'appointment.manual_create', 'appointment', v_appt.id::text, jsonb_build_object('outOfAvailability', coalesce(p_out_of_availability, false), 'resourceId', v_appt.resource_id));
  return jsonb_build_object('id', v_appt.id, 'reference', v_appt.reference, 'status', v_appt.status, 'startsAt', v_appt.starts_at, 'endsAt', v_appt.ends_at, 'resourceId', v_appt.resource_id);
end $$;
