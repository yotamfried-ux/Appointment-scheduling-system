-- Stage 8: customers (light CRM), reports, anonymization, no-show correction. Reads run as the signed-in user (SECURITY INVOKER),
-- so Row Level Security — not application code — keeps one business out of another's numbers.

alter table public.customers
  add column notes text check (notes is null or char_length(notes) <= 500),
  add column anonymized_at timestamptz;

-- ------------------------------------------------------------------ state machine: a mistaken no-show can be corrected (NSH-04); anonymization may clear PII fields
create or replace function private.appointments_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_anon boolean := coalesce(current_setting('app.anonymizing', true), '') = 'on';
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
     or new.service_snapshot <> old.service_snapshot or new.price_cents <> old.price_cents or new.location <> old.location
     or new.source <> old.source or new.out_of_availability <> old.out_of_availability
     or (not v_anon and (new.intake <> old.intake or new.owner_note is distinct from old.owner_note)) then
    raise exception 'appointment_immutable' using errcode = 'P0001';
  end if;
  if new.status <> old.status and not (
       (old.status = 'pending' and new.status in ('confirmed','cancelled_by_business','cancelled_by_customer'))
    or (old.status = 'confirmed' and new.status in ('completed','no_show','cancelled_by_customer','cancelled_by_business','cancellation_requested'))
    or (old.status = 'cancellation_requested' and new.status in ('cancelled_by_customer','cancelled_by_business','confirmed'))
    or (old.status = 'completed' and new.status = 'no_show')           -- NSH-04: marked wrongly, corrected both ways
    or (old.status = 'no_show' and new.status = 'completed')
  ) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ------------------------------------------------------------------ customers list (search / sort / paging) — RLS applies
create function public.owner_customers(p_business uuid, p_search text default null, p_sort text default 'last_visit', p_limit int default 50, p_offset int default 0)
returns table (id uuid, full_name text, phone text, email text, notes text, created_at timestamptz, anonymized_at timestamptz,
               visits int, no_shows int, no_shows_60d int, cancellations int, upcoming int, last_visit timestamptz, spent_cents bigint, total bigint)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select nullif(btrim(coalesce(p_search, '')), '') as s,
           regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g') as digits,
           -- phones are stored in international form (+9725…); owners type the local form (05…)
           case when regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g') like '0%' then '972' || substr(regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g'), 2)
                else regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g') end as intl
  ), base as (
    select c.id, c.full_name, c.phone, c.email, c.notes, c.created_at, c.anonymized_at,
           count(a.id) filter (where a.status = 'completed')::int as visits,
           count(a.id) filter (where a.status = 'no_show')::int as no_shows,
           count(a.id) filter (where a.status = 'no_show' and a.starts_at >= now() - interval '60 days')::int as no_shows_60d,        -- NSH-05: rolling window, never a stored counter
           count(a.id) filter (where a.status = 'cancelled_by_customer')::int as cancellations,
           count(a.id) filter (where a.status in ('pending', 'confirmed', 'cancellation_requested') and a.starts_at > now())::int as upcoming,
           max(a.starts_at) filter (where a.status = 'completed') as last_visit,
           coalesce(sum(a.price_cents) filter (where a.status = 'completed'), 0)::bigint as spent_cents
    from public.customers c
    left join public.appointments a on a.customer_id = c.id and a.business_id = c.business_id
    cross join q
    where c.business_id = p_business
      and (q.s is null
           or c.full_name ilike '%' || replace(replace(replace(q.s, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'      -- LIKE wildcards in the search are data, not syntax (SEC-09)
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

-- Keyset page for exports (ordered by id, larger pages).
create function public.owner_customers_page(p_business uuid, p_after uuid default null, p_limit int default 1000)
returns table (id uuid, full_name text, phone text, email text, notes text, created_at timestamptz, anonymized_at timestamptz,
               visits int, no_shows int, cancellations int, last_visit timestamptz, spent_cents bigint)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.full_name, c.phone, c.email, c.notes, c.created_at, c.anonymized_at,
         count(a.id) filter (where a.status = 'completed')::int,
         count(a.id) filter (where a.status = 'no_show')::int,
         count(a.id) filter (where a.status = 'cancelled_by_customer')::int,
         max(a.starts_at) filter (where a.status = 'completed'),
         coalesce(sum(a.price_cents) filter (where a.status = 'completed'), 0)::bigint
  from public.customers c
  left join public.appointments a on a.customer_id = c.id and a.business_id = c.business_id
  where c.business_id = p_business and (p_after is null or c.id > p_after)
  group by c.id
  order by c.id
  limit least(greatest(p_limit, 1), 2000)
$$;

create function public.owner_customer_detail(p_customer uuid) returns jsonb language sql stable security invoker set search_path = '' as $$
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
      from (select * from public.appointments a where a.customer_id = c.id order by a.starts_at desc limit 200) x), '[]'::jsonb)
  )
  from public.customers c where c.id = p_customer
$$;

-- ------------------------------------------------------------------ report: grouped counts per LOCAL day × service × status (RPT-04). All formulas live in TS (RPT-06).
create function public.owner_report(p_business uuid, p_from date, p_to date) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare b public.businesses; v_rows jsonb; v_new int; v_ret int; v_from_ts timestamptz;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then raise exception 'invalid_range' using errcode = '23514'; end if;
  select * into b from public.businesses where id = p_business;
  if not found then return null; end if;                                      -- RLS: another business simply is not there
  v_from_ts := p_from::timestamp at time zone b.timezone;
  select coalesce(jsonb_agg(jsonb_build_object('date', d, 'service', s, 'status', st, 'n', n, 'cents', cents) order by d, s, st), '[]'::jsonb) into v_rows
  from (select (a.starts_at at time zone b.timezone)::date as d, a.service_snapshot->>'name' as s, a.status as st, count(*) as n, coalesce(sum(a.price_cents), 0)::bigint as cents
        from public.appointments a
        where a.business_id = p_business and (a.starts_at at time zone b.timezone)::date between p_from and p_to
        group by 1, 2, 3) x;
  with firsts as (
    select a.customer_id, min(a.starts_at) as first_at from public.appointments a
    where a.business_id = p_business and a.status not in ('pending', 'cancelled_by_customer', 'cancelled_by_business') group by 1
  ), active as (
    select distinct a.customer_id from public.appointments a
    where a.business_id = p_business and a.status not in ('pending', 'cancelled_by_customer', 'cancelled_by_business')
      and (a.starts_at at time zone b.timezone)::date between p_from and p_to
  )
  select count(*) filter (where f.first_at >= v_from_ts), count(*) filter (where f.first_at < v_from_ts) into v_new, v_ret
  from active x join firsts f on f.customer_id = x.customer_id;
  return jsonb_build_object('timezone', b.timezone, 'from', p_from, 'to', p_to, 'rows', v_rows, 'newCustomers', coalesce(v_new, 0), 'returningCustomers', coalesce(v_ret, 0));
end $$;

-- ------------------------------------------------------------------ writes (system-checked: membership inside)
create function private.set_customer_notes_impl(p_customer uuid, p_notes text) returns void language plpgsql security definer set search_path = '' as $$
declare c public.customers;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into c from public.customers where id = p_customer;
  if not found or not private.is_member(c.business_id, 'staff') then raise exception 'forbidden' using errcode = '42501'; end if;
  if c.anonymized_at is not null then raise exception 'anonymized' using errcode = 'P0001'; end if;
  if char_length(coalesce(p_notes, '')) > 500 then raise exception 'notes_too_long' using errcode = '23514'; end if;
  update public.customers set notes = nullif(btrim(coalesce(p_notes, '')), '') where id = p_customer;
end $$;

-- CMP-02: erase the person, keep the numbers (appointments stay with service / price / time so reports remain true).
create function private.anonymize_customer_impl(p_customer uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.customers; v_phone text; v_tries int := 0; v_waitlist int;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into c from public.customers where id = p_customer for update;
  if not found or not private.is_member(c.business_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if c.anonymized_at is not null then return jsonb_build_object('outcome', 'already'); end if;
  if exists (select 1 from public.appointments a where a.customer_id = c.id and a.status in ('pending', 'confirmed', 'cancellation_requested') and a.starts_at > now()) then
    return jsonb_build_object('outcome', 'has_upcoming');                      -- cancel or finish the future appointments first
  end if;
  update public.waitlist_entries set status = 'cancelled' where customer_id = c.id and status in ('waiting', 'offered');
  get diagnostics v_waitlist = row_count;
  perform set_config('app.anonymizing', 'on', true);
  update public.appointments set intake = '{}'::jsonb, owner_note = null where customer_id = c.id;
  loop
    v_phone := '+999' || lpad((('x' || substr(md5(c.id::text || v_tries::text), 1, 8))::bit(32)::bigint)::text, 10, '0');
    begin
      update public.customers set full_name = 'לקוח שנמחק', phone = v_phone, email = null, notes = null, anonymized_at = now() where id = c.id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 5 then raise; end if;
    end;
  end loop;
  perform set_config('app.anonymizing', 'off', true);
  perform private.audit_write(c.business_id, 'customer.anonymize', 'customer', c.id::text, jsonb_build_object('waitlistClosed', v_waitlist));
  return jsonb_build_object('outcome', 'anonymized');
end $$;

create function private.export_audit_impl(p_business uuid, p_kind text, p_rows int) returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not private.is_member(p_business, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_kind not in ('customers', 'appointments') then raise exception 'invalid_kind' using errcode = '23514'; end if;
  perform private.audit_write(p_business, 'export.' || p_kind, 'export', p_kind, jsonb_build_object('rows', greatest(p_rows, 0)));
end $$;

create function public.set_customer_notes(p_customer uuid, p_notes text) returns void language sql security invoker set search_path = '' as $$ select private.set_customer_notes_impl(p_customer, p_notes) $$;
create function public.anonymize_customer(p_customer uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.anonymize_customer_impl(p_customer) $$;
create function public.export_audit(p_business uuid, p_kind text, p_rows int) returns void language sql security invoker set search_path = '' as $$ select private.export_audit_impl(p_business, p_kind, p_rows) $$;

do $$
declare f text;
begin
  for f in select unnest(array[
    'private.set_customer_notes_impl(uuid,text)', 'private.anonymize_customer_impl(uuid)', 'private.export_audit_impl(uuid,text,int)',
    'public.set_customer_notes(uuid,text)', 'public.anonymize_customer(uuid)', 'public.export_audit(uuid,text,int)',
    'public.owner_customers(uuid,text,text,int,int)', 'public.owner_customers_page(uuid,uuid,int)', 'public.owner_customer_detail(uuid)', 'public.owner_report(uuid,date,date)'
  ]) loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
