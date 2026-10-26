-- Customer contact management, manual appointment customer linking, deduplication & merge.

-- 1. Update customer details (name, phone, email)
create or replace function private.update_customer_details_impl(p_customer uuid, p_full_name text, p_phone text, p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_key text;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into c from public.customers where id = p_customer for update;
  if not found or not private.is_member(c.business_id, 'staff') then raise exception 'forbidden' using errcode = '42501'; end if;
  if c.anonymized_at is not null then raise exception 'anonymized' using errcode = 'P0001'; end if;

  if char_length(v_name) < 2 or char_length(v_name) > 80 then raise exception 'invalid_name' using errcode = '23514'; end if;
  if not (v_phone ~ '^\+[1-9][0-9]{7,14}$') then raise exception 'invalid_phone' using errcode = '23514'; end if;

  if v_email is not null then
    if char_length(v_email) > 254 or not (v_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then
      raise exception 'invalid_email' using errcode = '23514';
    end if;
    v_key := private.mailbox_key(v_email);
    if exists (select 1 from public.customers where business_id = c.business_id and email_key = v_key and id <> c.id and anonymized_at is null) then
      raise exception 'email_conflict' using errcode = 'P0001';
    end if;
  end if;

  update public.customers
  set full_name = v_name,
      phone = v_phone,
      email = v_email
  where id = p_customer;

  if v_email is not null then
    update public.appointments
    set contact_email = v_email
    where customer_id = p_customer and contact_email is null;
  end if;

  perform private.audit_write(c.business_id, 'customer.updated', 'customer', c.id::text, jsonb_build_object('hasEmail', v_email is not null));
  return jsonb_build_object('ok', true, 'id', c.id);
end $$;

revoke all on function private.update_customer_details_impl(uuid, text, text, text) from public, anon;
grant execute on function private.update_customer_details_impl(uuid, text, text, text) to authenticated;

create or replace function public.update_customer_details(p_customer uuid, p_full_name text, p_phone text, p_email text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.update_customer_details_impl(p_customer, p_full_name, p_phone, p_email);
$$;

revoke all on function public.update_customer_details(uuid, text, text, text) from public, anon;
grant execute on function public.update_customer_details(uuid, text, text, text) to authenticated;


-- 2. Merge duplicate customers (source into target)
create or replace function private.merge_customers_impl(p_source_id uuid, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.customers;
  t public.customers;
  v_notes text;
  v_email text;
  v_appts int;
  v_waitlist int;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into s from public.customers where id = p_source_id for update;
  select * into t from public.customers where id = p_target_id for update;

  if not found or s.id is null or t.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if s.business_id <> t.business_id then raise exception 'business_mismatch' using errcode = 'P0001'; end if;
  if not private.is_member(t.business_id, 'staff') then raise exception 'forbidden' using errcode = '42501'; end if;

  if p_source_id is null or p_target_id is null or p_source_id = p_target_id then
    raise exception 'invalid_merge_targets' using errcode = '23514';
  end if;
  if s.anonymized_at is not null or t.anonymized_at is not null then raise exception 'anonymized' using errcode = 'P0001'; end if;

  if t.notes is null then
    v_notes := s.notes;
  elsif s.notes is null then
    v_notes := t.notes;
  elsif t.notes = s.notes then
    v_notes := t.notes;
  else
    v_notes := t.notes || E'\n' || s.notes;
  end if;

  v_email := coalesce(t.email, s.email);

  update public.appointments set customer_id = t.id where customer_id = s.id;
  get diagnostics v_appts = row_count;

  update public.waitlist_entries set customer_id = t.id where customer_id = s.id;
  get diagnostics v_waitlist = row_count;

  update public.customers
  set notes = v_notes,
      email = v_email
  where id = t.id;

  if v_email is not null then
    update public.appointments
    set contact_email = v_email
    where customer_id = t.id and contact_email is null;
  end if;

  delete from public.customers where id = s.id;

  perform private.audit_write(t.business_id, 'customer.merged', 'customer', t.id::text, jsonb_build_object('sourceId', s.id, 'appointmentsMoved', v_appts, 'waitlistMoved', v_waitlist));
  return jsonb_build_object('ok', true, 'targetId', t.id, 'appointmentsMoved', v_appts);
end $$;

revoke all on function private.merge_customers_impl(uuid, uuid) from public, anon;
grant execute on function private.merge_customers_impl(uuid, uuid) to authenticated;

create or replace function public.merge_customers(p_source_id uuid, p_target_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.merge_customers_impl(p_source_id, p_target_id);
$$;

revoke all on function public.merge_customers(uuid, uuid) from public, anon;
grant execute on function public.merge_customers(uuid, uuid) to authenticated;


-- 3. Upgrade manual appointment creation to accept customer_id and email
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
  p_customer_id uuid
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
        insert into public.appointments (business_id, resource_id, resource_chosen, service_id, customer_id, contact_email, reference, status, source, out_of_availability, owner_note, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
        values (p_business, v_res, p_resource is not null, s.id, v_cust, coalesce(v_email, v_cust_email), v_ref, 'confirmed', 'manual', coalesce(p_out_of_availability, false), nullif(btrim(coalesce(p_note, '')), ''),
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
  perform private.audit_write(p_business, 'appointment.manual_create', 'appointment', v_appt.id::text, jsonb_build_object('outOfAvailability', coalesce(p_out_of_availability, false), 'resourceId', v_appt.resource_id, 'customerId', v_cust));
  return jsonb_build_object('id', v_appt.id, 'reference', v_appt.reference, 'status', v_appt.status, 'startsAt', v_appt.starts_at, 'endsAt', v_appt.ends_at, 'resourceId', v_appt.resource_id, 'customerId', v_cust);
end $$;

create or replace function private.create_manual_appointment_team(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_note text, p_out_of_availability boolean, p_resource uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return private.create_manual_appointment_team(p_business, p_service, p_starts_at, p_full_name, p_phone, p_note, p_out_of_availability, p_resource, null::text, null::uuid);
end $$;

revoke all on function private.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid, text, uuid) from public, anon;
grant execute on function private.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid, text, uuid) to authenticated;

revoke all on function private.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid) from public, anon;
grant execute on function private.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid) to authenticated;

drop function if exists public.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid, text, uuid);

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
  p_customer_id uuid
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  return private.create_manual_appointment_team(p_business, p_service, p_starts_at, p_full_name, p_phone, p_note, p_out_of_availability, p_resource, p_email, p_customer_id);
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
  return private.create_manual_appointment_team(p_business, p_service, p_starts_at, p_full_name, p_phone, p_note, p_out_of_availability, p_resource, null::text, null::uuid);
end $$;

revoke all on function public.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid, text, uuid) from public, anon;
grant execute on function public.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid, text, uuid) to authenticated;

revoke all on function public.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid) from public, anon;
grant execute on function public.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid) to authenticated;


-- 4. Customer detail with duplicate detection
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
        'service', x.service_snapshot->>'name', 'priceCents', x.price_cents, 'source', x.source) order by x.starts_at desc)
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


-- 5. Customer list with filtering (e.g. missing_email, duplicates)
drop function if exists public.owner_customers(uuid, text, text, int, int);

create or replace function public.owner_customers(
  p_business uuid,
  p_search text default null,
  p_sort text default 'last_visit',
  p_limit int default 50,
  p_offset int default 0,
  p_filter text default null
)
returns table (id uuid, full_name text, phone text, email text, notes text, created_at timestamptz, anonymized_at timestamptz,
               visits int, no_shows int, no_shows_60d int, cancellations int, upcoming int, last_visit timestamptz, spent_cents bigint, total bigint)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select nullif(btrim(coalesce(p_search, '')), '') as s,
           regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g') as digits,
           case when regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g') like '0%' then '972' || substr(regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g'), 2)
                else regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g') end as intl
  ), base as (
    select c.id, c.full_name, c.phone, c.email, c.notes, c.created_at, c.anonymized_at,
           count(a.id) filter (where a.status = 'completed')::int as visits,
           count(a.id) filter (where a.status = 'no_show')::int as no_shows,
           count(a.id) filter (where a.status = 'no_show' and a.starts_at >= now() - interval '60 days')::int as no_shows_60d,
           count(a.id) filter (where a.status = 'cancelled_by_customer')::int as cancellations,
           count(a.id) filter (where a.status in ('pending', 'confirmed', 'cancellation_requested') and a.starts_at > now())::int as upcoming,
           max(a.starts_at) filter (where a.status = 'completed') as last_visit,
           coalesce(sum(a.price_cents) filter (where a.status = 'completed'), 0)::bigint as spent_cents
    from public.customers c
    left join public.appointments a on a.customer_id = c.id and a.business_id = c.business_id
    cross join q
    where c.business_id = p_business
      and (
        p_filter is null
        or (p_filter = 'missing_email' and c.email is null and c.anonymized_at is null)
        or (p_filter = 'duplicates' and exists (
          select 1 from public.customers d where d.business_id = c.business_id and d.phone = c.phone and d.id <> c.id and d.anonymized_at is null
        ))
      )
      and (q.s is null
           or c.full_name ilike '%' || replace(replace(replace(q.s, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
           or (length(q.digits) >= 3 and (c.phone like '%' || q.digits || '%' or c.phone like '%' || q.intl || '%')))
    group by c.id
  )
  select b.id, b.full_name, b.phone, b.email, b.notes, b.created_at, b.anonymized_at, b.visits, b.no_shows, b.no_shows_60d, b.cancellations, b.upcoming, b.last_visit, b.spent_cents,
         count(*) over () as total
  from base b
  order by
    case when p_sort = 'name' then b.full_name end asc,
    case when p_sort = 'visits' then b.visits end desc,
    case when p_sort = 'spent' then b.spent_cents end desc,
    case when p_sort = 'no_shows' then b.no_shows_60d end desc,
    case when p_sort = 'created' then b.created_at end desc,
    b.last_visit desc nulls last, b.full_name, b.id
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;

revoke all on function public.owner_customers(uuid,text,text,int,int,text) from public, anon;
grant execute on function public.owner_customers(uuid,text,text,int,int,text) to authenticated;
