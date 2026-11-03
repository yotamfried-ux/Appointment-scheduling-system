-- Dynamic availability concurrency hardening & appointment modality (FEATURE-01, FEATURE-02, FEATURE-03).
-- Forward-only migration.

-- 1. Service-level allowed modalities (locations).
-- null = inherit the business kind's default locations; otherwise a non-empty subset of ('business','customer','online').
alter table public.services
  add column if not exists locations text[]
  check (
    locations is null
    or (
      cardinality(locations) >= 1
      and locations <@ array['business','customer','online']::text[]
    )
  );

grant insert (locations), update (locations) on public.services to authenticated;

-- 2. Onboarding catalog writer: persist optional service locations and support arbitrary window counts per day.
create or replace function private.write_catalog(p_business uuid, p_resource uuid, p_services jsonb, p_hours jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s jsonb;
  d jsonb;
  w jsonb;
  pos int := 0;
  v_locs text[];
begin
  if jsonb_typeof(p_services) is distinct from 'array' or jsonb_array_length(p_services) not between 1 and 30 then
    raise exception 'invalid_services' using errcode = '23514';
  end if;
  if jsonb_typeof(p_hours) is distinct from 'array' then raise exception 'invalid_hours' using errcode = '23514'; end if;
  for s in select * from jsonb_array_elements(p_services) loop
    if jsonb_typeof(s->'locations') = 'array' then
      select array_agg(x) into v_locs from jsonb_array_elements_text(s->'locations') x;
    else
      v_locs := null;
    end if;
    insert into public.services (business_id, name, duration_minutes, price_cents, position, locations)
    values (p_business, s->>'name', (s->>'durationMinutes')::int, ((s->>'priceNis')::int) * 100, pos, v_locs);
    pos := pos + 1;
  end loop;
  for d in select * from jsonb_array_elements(p_hours) loop
    if (d->>'open')::boolean then
      for w in select * from jsonb_array_elements(d->'windows') loop
        insert into public.availability_rules (business_id, resource_id, weekday, start_minute, end_minute)
        values (p_business, p_resource, (d->>'weekday')::smallint,
                (substr(w->>'from', 1, 2)::int * 60 + substr(w->>'from', 4, 2)::int),
                (substr(w->>'to', 1, 2)::int * 60 + substr(w->>'to', 4, 2)::int));
      end loop;
    end if;
  end loop;
end $$;

revoke all on function private.write_catalog(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;

-- 3. Serialize concurrent weekly-hours writes for the same resource via row-level lock on public.resources.
create or replace function private.write_hours(p_business uuid, p_resource uuid, p_hours jsonb) returns int
language plpgsql set search_path = '' as $$
declare d jsonb; w jsonb; n int := 0;
begin
  if jsonb_typeof(p_hours) is distinct from 'array' then raise exception 'invalid_hours' using errcode = '23514'; end if;
  perform 1 from public.resources where id = p_resource and business_id = p_business for update;
  delete from public.availability_rules where business_id = p_business and resource_id = p_resource;
  for d in select * from jsonb_array_elements(p_hours) loop
    if (d->>'open')::boolean then
      for w in select * from jsonb_array_elements(d->'windows') loop
        insert into public.availability_rules (business_id, resource_id, weekday, start_minute, end_minute)
        values (p_business, p_resource, (d->>'weekday')::smallint,
                (substr(w->>'from', 1, 2)::int * 60 + substr(w->>'from', 4, 2)::int),
                (substr(w->>'to', 1, 2)::int * 60 + substr(w->>'to', 4, 2)::int));
        n := n + 1;
      end loop;
    end if;
  end loop;
  return n;
end $$;

revoke all on function private.write_hours(uuid, uuid, jsonb) from public, anon, authenticated;

-- 4. Public catalog: include per-service allowed locations.
create or replace function private.public_catalog(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_slug text := private.normalize_slug(p_slug);
  b public.businesses;
begin
  select * into b from public.businesses where lower(slug) = v_slug;
  if not found then
    select x.* into b from public.slug_redirects r join public.businesses x on x.id = r.business_id where r.old_slug = v_slug;
    if not found then return null; end if;
    if b.published_at is null then return null; end if;
    return jsonb_build_object('redirect', b.slug);
  end if;
  if b.published_at is null then return null; end if;
  return jsonb_build_object(
    'business', jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'kind', b.kind, 'timezone', b.timezone, 'address', coalesce(b.address, ''),
      'requiresApproval', b.requires_approval, 'cancelUntilHours', b.cancel_until_hours, 'minNoticeMinutes', b.min_notice_minutes, 'horizonDays', b.booking_horizon_days, 'waitlistEnabled', b.waitlist_enabled and private.entitlement_can(b.id, 'waitlist'),
      'acceptingBookings', private.billing_accepts(b.id)),
    'team', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by r.position, r.id) from public.resources r where r.business_id = b.id and r.active), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', coalesce(s.description, ''), 'durationMinutes', s.duration_minutes,
        'bufferMinutes', s.buffer_minutes, 'priceCents', s.price_cents, 'priceMode', s.price_mode, 'requiresApproval', s.requires_approval,
        'locations', s.locations,
        'staffIds', (select jsonb_agg(x.resource_id order by x.resource_id) from public.service_staff x join public.resources rr on rr.id = x.resource_id and rr.active where x.service_id = s.id)) order by s.position, s.created_at)
        from public.services s where s.business_id = b.id and s.active and s.capacity = 1), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('resourceId', r.resource_id, 'weekday', r.weekday, 'startMinute', r.start_minute, 'endMinute', r.end_minute))
        from public.availability_rules r join public.resources rr on rr.id = r.resource_id and rr.active where r.business_id = b.id), '[]'::jsonb),
    'exceptions', coalesce((select jsonb_agg(jsonb_build_object('resourceId', e.resource_id, 'date', e.on_date, 'kind', e.kind, 'startMinute', e.start_minute, 'endMinute', e.end_minute))
        from public.availability_exceptions e where e.business_id = b.id and e.on_date >= (current_date - 2)
          and (e.resource_id is null or exists (select 1 from public.resources rr where rr.id = e.resource_id and rr.active))), '[]'::jsonb)
  );
end $$;

revoke all on function private.public_catalog(text) from public, anon, authenticated;
grant execute on function private.public_catalog(text) to service_role;

-- 5. Public booking: enforce service-allowed locations, persist location in appointment and snapshot, and return location.
create or replace function private.public_book_team(
  p_business uuid,
  p_service uuid,
  p_starts_at timestamptz,
  p_full_name text,
  p_phone text,
  p_email text,
  p_location text,
  p_intake jsonb,
  p_idem_key text,
  p_request_hash text,
  p_resources uuid[],
  p_chosen boolean,
  p_terms_version text default null,
  p_privacy_version text default null
)
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
  v_location text;
begin
  select * into b from public.businesses where id = p_business and published_at is not null;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;

  select * into v_prior from public.booking_idempotency where business_id = p_business and idem_key = p_idem_key;
  if found then
    if v_prior.request_hash <> p_request_hash then raise exception 'idempotency_reuse' using errcode = 'P0001'; end if;
    select * into v_appt from public.appointments where id = v_prior.appointment_id;
    return jsonb_build_object('replay', true, 'id', v_appt.id, 'reference', v_appt.reference, 'status', v_appt.status, 'startsAt', v_appt.starts_at, 'endsAt', v_appt.ends_at, 'resourceId', v_appt.resource_id, 'location', v_appt.location);
  end if;

  select * into s from public.services where id = p_service and business_id = p_business and active and capacity = 1;
  if not found then raise exception 'service_unavailable' using errcode = 'P0001'; end if;

  v_location := coalesce(
    nullif(btrim(coalesce(p_location, '')), ''),
    case when s.locations is not null and cardinality(s.locations) > 0 then s.locations[1] else 'business' end
  );
  if v_location not in ('business', 'customer', 'online') then
    raise exception 'invalid_location' using errcode = '23514';
  end if;
  if s.locations is not null and cardinality(s.locations) > 0 and not (v_location = any(s.locations)) then
    raise exception 'invalid_location' using errcode = '23514';
  end if;

  v_cands := private.team_candidates(p_business, p_service, p_starts_at, p_resources);
  if cardinality(v_cands) = 0 then raise exception 'slot_taken' using errcode = 'P0001'; end if;
  if p_starts_at < now() + make_interval(mins => b.min_notice_minutes) then raise exception 'slot_in_past' using errcode = 'P0001'; end if;
  if p_starts_at > now() + make_interval(days => b.booking_horizon_days) then raise exception 'slot_too_far' using errcode = 'P0001'; end if;

  if nullif(btrim(coalesce(p_email, '')), '') is null then raise exception 'invalid_input' using errcode = '23514'; end if;
  insert into public.customers (business_id, full_name, phone, email, email_key) values (p_business, btrim(p_full_name), p_phone, btrim(p_email), private.mailbox_key(p_email))
  on conflict (business_id, email_key) where email_key is not null do update set full_name = public.customers.full_name
  returning id, policy_override into v_cust, v_override;

  if (select count(*) from public.appointments where business_id = p_business and customer_id = v_cust and starts_at > now()
        and status in ('pending','confirmed','cancellation_requested')) >= 5 then
    raise exception 'booking_limit' using errcode = 'P0001';
  end if;

  if b.no_show_policy in ('block', 'require_approval') and not v_override
     and (select count(*) from public.appointments where business_id = p_business and customer_id = v_cust and status = 'no_show' and starts_at >= now() - interval '60 days') >= b.no_show_threshold then
    if b.no_show_policy = 'block' then raise exception 'customer_blocked' using errcode = 'P0001', detail = coalesce(b.block_message, ''); end if;
    v_force_pending := true;
  end if;

  v_status := case when v_force_pending or coalesce(s.requires_approval, b.requires_approval) then 'pending' else 'confirmed' end;
  foreach v_res in array v_cands loop
    if exists (select 1 from public.waitlist_offers o where o.resource_id = v_res and o.status = 'pending' and o.expires_at > now()
               and tstzrange(o.slot_starts_at, o.blocked_until, '[)') && tstzrange(p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes + s.buffer_minutes), '[)')) then
      continue;
    end if;
    v_tries := 0;
    loop
      v_ref := 'TR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      begin
        insert into public.appointments (business_id, resource_id, resource_chosen, service_id, customer_id, contact_email, terms_version, privacy_version, terms_accepted_at, reference, status, location, intake, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
        values (p_business, v_res, coalesce(p_chosen, false), s.id, v_cust, nullif(btrim(coalesce(p_email, '')), ''), p_terms_version, p_privacy_version, case when p_terms_version is not null then now() end, v_ref, v_status, v_location, coalesce(p_intake, '{}'::jsonb), p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes),
                p_starts_at + make_interval(mins => s.duration_minutes + s.buffer_minutes),
                jsonb_build_object('name', s.name, 'durationMinutes', s.duration_minutes, 'bufferMinutes', s.buffer_minutes, 'priceCents', s.price_cents, 'location', v_location), s.price_cents, s.currency)
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
  insert into public.booking_idempotency (business_id, idem_key, request_hash, appointment_id) values (p_business, p_idem_key, p_request_hash, v_appt.id);
  perform private.enqueue_event(p_business, 'AppointmentCreated', jsonb_build_object('appointmentId', v_appt.id), 'appt:' || v_appt.id::text);
  return jsonb_build_object('replay', false, 'id', v_appt.id, 'reference', v_appt.reference, 'status', v_appt.status, 'startsAt', v_appt.starts_at, 'endsAt', v_appt.ends_at, 'resourceId', v_appt.resource_id, 'location', v_appt.location);
end $$;

revoke all on function private.public_book_team(uuid, uuid, timestamptz, text, text, text, text, jsonb, text, text, uuid[], boolean, text, text) from public, anon, authenticated;
grant execute on function private.public_book_team(uuid, uuid, timestamptz, text, text, text, text, jsonb, text, text, uuid[], boolean, text, text) to service_role;

-- 6. Public appointment view: include location so customer manage/reschedule pages display modality.
create or replace function private.public_get_appointment(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'reference', a.reference, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at,
    'serviceName', a.service_snapshot->>'name', 'serviceId', a.service_id, 'priceMode', (select s.price_mode from public.services s where s.id = a.service_id), 'priceCents', a.price_cents,
    'businessName', b.name, 'businessSlug', b.slug, 'timezone', b.timezone,
    'cancelUntil', case when a.moved_by_business_at is not null then a.starts_at else a.starts_at - make_interval(hours => b.cancel_until_hours) end,
    'updatedAt', a.updated_at, 'rescheduledCount', a.rescheduled_count,
    'attendanceConfirmedAt', a.attendance_confirmed_at, 'serviceChangeAllowed', b.reschedule_service_change, 'movedByBusinessAt', a.moved_by_business_at,
    'resourceId', a.resource_id, 'resourceChosen', a.resource_chosen, 'personName', r.name,
    'location', a.location,
    'teamSize', (select count(*) from public.resources x where x.business_id = a.business_id and x.active))
  from public.appointments a join public.businesses b on b.id = a.business_id join public.resources r on r.id = a.resource_id where a.id = p_id
$$;

revoke all on function private.public_get_appointment(uuid) from public, anon, authenticated;
grant execute on function private.public_get_appointment(uuid) to service_role;

-- 7. Owner customer detail: include location in each appointment history item.
create or replace function public.owner_customer_detail(p_customer uuid) returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'customer', jsonb_build_object('id', c.id, 'fullName', c.full_name, 'phone', c.phone, 'email', c.email, 'notes', c.notes, 'createdAt', c.created_at, 'anonymizedAt', c.anonymized_at),
    'stats', (select jsonb_build_object(
        'visits', count(a.id) filter (where a.status = 'completed'),
        'noShows', count(a.id) filter (where a.status = 'no_show'),
        'noShows60d', count(a.id) filter (where a.status = 'no_show' and a.starts_at >= now() - interval '60 days'),
        'cancellations', count(a.id) filter (where a.status = 'cancelled_by_customer'),
        'upcoming', count(a.id) filter (where a.status in ('pending', 'confirmed', 'cancellation_requested') and a.starts_at > now()),
        'spentCents', coalesce(sum(a.price_cents) filter (where a.status = 'completed'), 0))
      from public.appointments a where a.customer_id = c.id),
    'appointments', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'reference', x.reference, 'status', x.status, 'startsAt', x.starts_at,
        'service', x.service_snapshot->>'name', 'priceCents', x.price_cents, 'source', x.source, 'location', x.location) order by x.starts_at desc)
      from (select * from public.appointments a where a.customer_id = c.id order by a.starts_at desc limit 200) x), '[]'::jsonb),
    'duplicates', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'fullName', d.full_name, 'phone', d.phone, 'email', d.email, 'createdAt', d.created_at))
      from public.customers d
      where d.business_id = c.business_id and d.phone = c.phone and d.id <> c.id and d.anonymized_at is null
    ), '[]'::jsonb)
  )
  from public.customers c where c.id = p_customer
$$;

revoke all on function public.owner_customer_detail(uuid) from public, anon;
grant execute on function public.owner_customer_detail(uuid) to authenticated;

-- 8. Manual appointment creation: support optional p_location (defaults to first service location or 'business').
drop function if exists public.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid, text, uuid);
drop function if exists private.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid, text, uuid);

create or replace function private.create_manual_appointment_team(
  p_business uuid,
  p_service uuid,
  p_starts_at timestamptz,
  p_full_name text,
  p_phone text,
  p_note text,
  p_out_of_availability boolean,
  p_resource uuid,
  p_email text,
  p_customer_id uuid,
  p_location text default null
)
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
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_cust_email text;
  v_location text;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not private.is_member(p_business, 'staff') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from public.services where id = p_service and business_id = p_business and active and capacity = 1;
  if not found then raise exception 'service_unavailable' using errcode = 'P0001'; end if;

  v_location := coalesce(
    nullif(btrim(coalesce(p_location, '')), ''),
    case when s.locations is not null and cardinality(s.locations) > 0 then s.locations[1] else 'business' end
  );
  if v_location not in ('business', 'customer', 'online') then
    raise exception 'invalid_location' using errcode = '23514';
  end if;
  if s.locations is not null and cardinality(s.locations) > 0 and not (v_location = any(s.locations)) then
    raise exception 'invalid_location' using errcode = '23514';
  end if;

  if p_resource is not null and not exists (select 1 from public.resources r where r.id = p_resource and r.business_id = p_business) then
    raise exception 'resource_mismatch' using errcode = 'P0001';
  end if;
  v_cands := private.team_candidates(p_business, p_service, p_starts_at, case when p_resource is null then null else array[p_resource] end);
  if cardinality(v_cands) = 0 then raise exception 'service_unavailable' using errcode = 'P0001'; end if;
  if p_starts_at < now() - interval '24 hours' then raise exception 'slot_in_past' using errcode = 'P0001'; end if;
  if p_starts_at > now() + interval '400 days' then raise exception 'slot_too_far' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_full_name, ''))) < 2 or char_length(p_full_name) > 80 then raise exception 'invalid_name' using errcode = '23514'; end if;

  if p_customer_id is not null then
    select id, email into v_cust, v_cust_email from public.customers where id = p_customer_id and business_id = p_business and anonymized_at is null;
    if v_cust is not null and v_cust_email is null and v_email is not null then
      update public.customers set email = v_email where id = v_cust;
      v_cust_email := v_email;
    end if;
  end if;

  if v_cust is null then
    select id, email into v_cust, v_cust_email from public.customers where business_id = p_business and phone = p_phone and anonymized_at is null order by created_at, id limit 1;
    if v_cust is null then
      insert into public.customers (business_id, full_name, phone, email) values (p_business, btrim(p_full_name), p_phone, v_email) returning id, email into v_cust, v_cust_email;
    elsif v_cust_email is null and v_email is not null then
      update public.customers set email = v_email where id = v_cust;
      v_cust_email := v_email;
    end if;
  end if;

  foreach v_res in array v_cands loop
    v_tries := 0;
    loop
      v_ref := 'TR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      begin
        insert into public.appointments (business_id, resource_id, resource_chosen, service_id, customer_id, contact_email, reference, status, source, location, out_of_availability, owner_note, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
        values (p_business, v_res, p_resource is not null, s.id, v_cust, coalesce(v_email, v_cust_email), v_ref, 'confirmed', 'manual', v_location, coalesce(p_out_of_availability, false), nullif(btrim(coalesce(p_note, '')), ''),
                p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes), p_starts_at + make_interval(mins => s.duration_minutes + s.buffer_minutes),
                jsonb_build_object('name', s.name, 'durationMinutes', s.duration_minutes, 'bufferMinutes', s.buffer_minutes, 'priceCents', s.price_cents, 'location', v_location), s.price_cents, s.currency)
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
  perform private.audit_write(p_business, 'appointment.manual_create', 'appointment', v_appt.id::text, jsonb_build_object('outOfAvailability', coalesce(p_out_of_availability, false), 'resourceId', v_appt.resource_id, 'customerId', v_cust, 'location', v_appt.location));
  return jsonb_build_object('id', v_appt.id, 'reference', v_appt.reference, 'status', v_appt.status, 'startsAt', v_appt.starts_at, 'endsAt', v_appt.ends_at, 'resourceId', v_appt.resource_id, 'customerId', v_cust, 'location', v_appt.location);
end $$;

create or replace function private.create_manual_appointment_team(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_note text, p_out_of_availability boolean, p_resource uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return private.create_manual_appointment_team(p_business, p_service, p_starts_at, p_full_name, p_phone, p_note, p_out_of_availability, p_resource, null::text, null::uuid, null::text);
end $$;

revoke all on function private.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid, text, uuid, text) from public, anon;
grant execute on function private.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid, text, uuid, text) to authenticated;

revoke all on function private.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid) from public, anon;
grant execute on function private.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid) to authenticated;

create or replace function public.create_manual_appointment_team(
  p_business uuid,
  p_service uuid,
  p_starts_at timestamptz,
  p_full_name text,
  p_phone text,
  p_note text,
  p_out_of_availability boolean,
  p_resource uuid,
  p_email text,
  p_customer_id uuid,
  p_location text default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  return private.create_manual_appointment_team(p_business, p_service, p_starts_at, p_full_name, p_phone, p_note, p_out_of_availability, p_resource, p_email, p_customer_id, p_location);
end $$;

create or replace function public.create_manual_appointment_team(
  p_business uuid,
  p_service uuid,
  p_starts_at timestamptz,
  p_full_name text,
  p_phone text,
  p_note text,
  p_out_of_availability boolean,
  p_resource uuid
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  return private.create_manual_appointment_team(p_business, p_service, p_starts_at, p_full_name, p_phone, p_note, p_out_of_availability, p_resource, null::text, null::uuid, null::text);
end $$;

revoke all on function public.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid, text, uuid, text) from public, anon;
grant execute on function public.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid, text, uuid, text) to authenticated;

revoke all on function public.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid) from public, anon;
grant execute on function public.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid) to authenticated;
