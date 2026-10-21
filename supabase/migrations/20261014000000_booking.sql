-- Stage 4: public booking (docs/04 BKG-*, docs/05 §5.3/§5.4). Forward-only.
-- Conflicts are decided by the DATABASE (EXCLUDE), opening hours by the TS slot engine (re-validated server side).

-- ------------------------------------------------------------------ business booking settings
alter table public.businesses
  add column requires_approval boolean not null default false,
  add column cancel_until_hours int not null default 12 check (cancel_until_hours between 0 and 720),
  add column min_notice_minutes int not null default 60 check (min_notice_minutes between 0 and 10080),
  add column booking_horizon_days int not null default 60 check (booking_horizon_days between 1 and 365),
  add column address text check (address is null or char_length(address) <= 120);
grant update (address, requires_approval, cancel_until_hours, min_notice_minutes, booking_horizon_days) on public.businesses to authenticated;

-- ------------------------------------------------------------------ tables
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 80),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, phone)                       -- BKG-05: one customer per normalized phone per business
);
create trigger customers_touch before update on public.customers for each row execute function private.touch_updated_at();

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  resource_id uuid not null references public.resources (id),
  service_id uuid not null references public.services (id),
  customer_id uuid not null references public.customers (id),
  reference text not null unique,
  status text not null default 'confirmed' check (status in ('pending','confirmed','cancellation_requested','cancelled_by_customer','cancelled_by_business','completed','no_show')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocked_until timestamptz not null,               -- ends_at + service buffer: what the slot engine must not offer
  location text not null default 'business' check (location in ('business','customer','online')),
  intake jsonb not null default '{}'::jsonb check (jsonb_typeof(intake) = 'object' and pg_column_size(intake) <= 4096),   -- provider-only answers; never put in messages (docs/05 §2)
  service_snapshot jsonb not null,                   -- name/duration/price at booking time (later edits never rewrite history)
  price_cents int not null check (price_cents >= 0),
  currency text not null default 'ILS',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (starts_at < ends_at and ends_at <= blocked_until),
  -- BKG-02: two active appointments can never overlap on one resource, whatever the application does.
  exclude using gist (resource_id with =, tstzrange(starts_at, blocked_until, '[)') with &&)
    where (status in ('pending','confirmed','cancellation_requested'))
);
create index appointments_business_idx on public.appointments (business_id, starts_at);
create index appointments_customer_idx on public.appointments (business_id, customer_id, starts_at);
create trigger appointments_touch before update on public.appointments for each row execute function private.touch_updated_at();

create table public.booking_idempotency (
  business_id uuid not null references public.businesses (id) on delete cascade,
  idem_key text not null check (char_length(idem_key) between 8 and 128),
  request_hash text not null,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (business_id, idem_key)
);

create table public.token_uses (                    -- single-use customer tokens (SEC-06)
  jti text primary key check (char_length(jti) between 8 and 64),
  expires_at timestamptz not null,
  used_at timestamptz not null default now()
);

alter table public.customers enable row level security;           alter table public.customers force row level security;
alter table public.appointments enable row level security;        alter table public.appointments force row level security;
alter table public.booking_idempotency enable row level security; alter table public.booking_idempotency force row level security;
alter table public.token_uses enable row level security;          alter table public.token_uses force row level security;

create policy customers_select on public.customers for select to authenticated using (private.is_member(business_id, 'staff'));
create policy appointments_select on public.appointments for select to authenticated using (private.is_member(business_id, 'staff'));
grant select on public.customers, public.appointments to authenticated;     -- writes: only through the RPCs below

-- Cross-tenant FK smuggling guard + immutable core + state machine.
create function private.appointments_guard() returns trigger language plpgsql set search_path = '' as $$
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
     or new.service_snapshot <> old.service_snapshot or new.price_cents <> old.price_cents or new.intake <> old.intake or new.location <> old.location then
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
create trigger appointments_guard before insert or update on public.appointments for each row execute function private.appointments_guard();

-- ------------------------------------------------------------------ business creation: approval default follows the kind
create or replace function private.create_business_impl(p_name text, p_kind text, p_phone text, p_slug text, p_services jsonb, p_hours jsonb)
returns public.businesses language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_slug text := private.normalize_slug(p_slug);
  v_row public.businesses;
  v_resource uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if (select count(*) from public.business_members where user_id = v_uid and role = 'owner') >= 3 then
    raise exception 'business_limit' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.slug_redirects where old_slug = v_slug) then
    raise exception 'slug_taken' using errcode = 'P0001';
  end if;
  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;
  -- Mirrors modules/tenancy/business-kind.ts defaults (clinic: manual approval); owners can change it later.
  insert into public.businesses (slug, name, kind, phone, created_by, requires_approval)
  values (v_slug, btrim(p_name), p_kind, p_phone, v_uid, p_kind = 'clinic') returning * into v_row;
  insert into public.business_members (business_id, user_id, role) values (v_row.id, v_uid, 'owner');
  insert into public.resources (business_id, name, kind, is_default) values (v_row.id, btrim(p_name), 'business', true) returning id into v_resource;
  perform private.write_catalog(v_row.id, v_resource, p_services, p_hours);
  perform private.audit_write(v_row.id, 'business.created', 'business', v_row.id::text, jsonb_build_object('kind', p_kind));
  perform private.enqueue_event(v_row.id, 'BusinessCreated', jsonb_build_object('slug', v_slug), 'created');
  return v_row;
exception when unique_violation then
  raise exception 'slug_taken' using errcode = 'P0001';
end $$;

-- ------------------------------------------------------------------ public (system-path) functions
-- Called only by the server with the service role. Wrappers are SECURITY INVOKER and granted to service_role ONLY.
create function private.public_catalog(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_slug text := private.normalize_slug(p_slug);
  b public.businesses;
  v_res uuid;
begin
  select * into b from public.businesses where lower(slug) = v_slug;
  if not found then
    select x.* into b from public.slug_redirects r join public.businesses x on x.id = r.business_id where r.old_slug = v_slug;
    if not found then return null; end if;
    if b.published_at is null then return null; end if;
    return jsonb_build_object('redirect', b.slug);          -- old link keeps working (ACC-07)
  end if;
  if b.published_at is null then return null; end if;      -- unknown and unpublished look identical (BKG-11, no enumeration)
  select id into v_res from public.resources where business_id = b.id and is_default;
  return jsonb_build_object(
    'business', jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'kind', b.kind, 'timezone', b.timezone, 'address', coalesce(b.address, ''),
      'requiresApproval', b.requires_approval, 'cancelUntilHours', b.cancel_until_hours, 'minNoticeMinutes', b.min_notice_minutes, 'horizonDays', b.booking_horizon_days),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', coalesce(s.description, ''), 'durationMinutes', s.duration_minutes,
        'bufferMinutes', s.buffer_minutes, 'priceCents', s.price_cents, 'requiresApproval', s.requires_approval) order by s.position, s.created_at)
        from public.services s where s.business_id = b.id and s.active and s.capacity = 1), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('weekday', r.weekday, 'startMinute', r.start_minute, 'endMinute', r.end_minute))
        from public.availability_rules r where r.business_id = b.id and r.resource_id = v_res), '[]'::jsonb),
    'exceptions', coalesce((select jsonb_agg(jsonb_build_object('date', e.on_date, 'kind', e.kind, 'startMinute', e.start_minute, 'endMinute', e.end_minute))
        from public.availability_exceptions e where e.business_id = b.id and e.resource_id = v_res and e.on_date >= (current_date - 2)), '[]'::jsonb)
  );
end $$;

create function private.public_busy(p_business uuid, p_from timestamptz, p_to timestamptz)
returns table (starts_at timestamptz, blocked_until timestamptz) language sql stable security definer set search_path = '' as $$
  select a.starts_at, a.blocked_until from public.appointments a
  where a.business_id = p_business and a.status in ('pending','confirmed','cancellation_requested')
    and a.starts_at < p_to and a.blocked_until > p_from
$$;

create function private.public_book(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_email text, p_location text, p_intake jsonb, p_idem_key text, p_request_hash text)
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
  on conflict (business_id, phone) do update set full_name = excluded.full_name, email = coalesce(excluded.email, public.customers.email)   -- BKG-05
  returning id into v_cust;

  -- BKG-07: bounded number of future active appointments per customer.
  if (select count(*) from public.appointments where business_id = p_business and customer_id = v_cust and starts_at > now()
        and status in ('pending','confirmed','cancellation_requested')) >= 5 then
    raise exception 'booking_limit' using errcode = 'P0001';
  end if;

  v_status := case when coalesce(s.requires_approval, b.requires_approval) then 'pending' else 'confirmed' end;   -- BKG-09
  loop
    v_ref := 'TR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, location, intake, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
      values (p_business, v_res, s.id, v_cust, v_ref, v_status, coalesce(p_location, 'business'), coalesce(p_intake, '{}'::jsonb), p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes),
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

-- What a customer holding a valid link may see: their own appointment only.
create function private.public_get_appointment(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'reference', a.reference, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at,
    'serviceName', a.service_snapshot->>'name', 'priceCents', a.price_cents, 'businessName', b.name, 'businessSlug', b.slug, 'timezone', b.timezone,
    'cancelUntil', a.starts_at - make_interval(hours => b.cancel_until_hours))
  from public.appointments a join public.businesses b on b.id = a.business_id where a.id = p_id
$$;

create function private.public_cancel(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.appointments; b public.businesses;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  select * into b from public.businesses where id = a.business_id;
  if a.status not in ('pending','confirmed') then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
  if now() > a.starts_at - make_interval(hours => b.cancel_until_hours) then raise exception 'too_late' using errcode = 'P0001'; end if;
  update public.appointments set status = 'cancelled_by_customer', cancelled_at = now() where id = p_id;
  perform private.enqueue_event(a.business_id, 'AppointmentCancelled', jsonb_build_object('appointmentId', a.id, 'by', 'customer'), 'cancel:' || a.id::text);
  return jsonb_build_object('id', a.id, 'status', 'cancelled_by_customer');
end $$;

create function private.public_consume_token(p_jti text, p_exp timestamptz) returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.token_uses where expires_at < now() - interval '1 day';   -- housekeeping
  insert into public.token_uses (jti, expires_at) values (p_jti, p_exp) on conflict (jti) do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- Owner-side transitions (used by the dashboard in stage 5); role is checked against business_members.
create function private.transition_appointment_impl(p_id uuid, p_action text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.appointments; v_to text;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into a from public.appointments where id = p_id for update;
  if not found or not private.is_member(a.business_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  v_to := case p_action when 'approve' then 'confirmed' when 'reject' then 'cancelled_by_business' when 'cancel' then 'cancelled_by_business'
                        when 'complete' then 'completed' when 'no_show' then 'no_show' when 'approve_cancellation' then 'cancelled_by_customer'
                        when 'decline_cancellation' then 'confirmed' end;
  if v_to is null then raise exception 'invalid_action' using errcode = '23514'; end if;
  if v_to = a.status then raise exception 'invalid_transition' using errcode = 'P0001'; end if;   -- no silent no-op "transitions" (and no audit noise)
  update public.appointments set status = v_to, cancelled_at = case when v_to like 'cancelled%' then now() else cancelled_at end where id = p_id;
  perform private.audit_write(a.business_id, 'appointment.' || p_action, 'appointment', p_id::text, jsonb_build_object('from', a.status, 'to', v_to));
  return jsonb_build_object('id', p_id, 'status', v_to);
end $$;
revoke all on function private.transition_appointment_impl(uuid, text) from public, anon;
grant execute on function private.transition_appointment_impl(uuid, text) to authenticated;

-- ------------------------------------------------------------------ wrappers + grants
create function public.transition_appointment(p_id uuid, p_action text) returns jsonb language sql security invoker set search_path = '' as $$
  select private.transition_appointment_impl(p_id, p_action)
$$;
revoke all on function public.transition_appointment(uuid, text) from public, anon;
grant execute on function public.transition_appointment(uuid, text) to authenticated;

create function public.public_catalog(p_slug text) returns jsonb language sql stable security invoker set search_path = '' as $$ select private.public_catalog(p_slug) $$;
create function public.public_busy(p_business uuid, p_from timestamptz, p_to timestamptz) returns table (starts_at timestamptz, blocked_until timestamptz) language sql stable security invoker set search_path = '' as $$ select * from private.public_busy(p_business, p_from, p_to) $$;
create function public.public_book(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_email text, p_location text, p_intake jsonb, p_idem_key text, p_request_hash text) returns jsonb language sql security invoker set search_path = '' as $$
  select private.public_book(p_business, p_service, p_starts_at, p_full_name, p_phone, p_email, p_location, p_intake, p_idem_key, p_request_hash) $$;
create function public.public_get_appointment(p_id uuid) returns jsonb language sql stable security invoker set search_path = '' as $$ select private.public_get_appointment(p_id) $$;
create function public.public_cancel(p_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.public_cancel(p_id) $$;
create function public.public_consume_token(p_jti text, p_exp timestamptz) returns boolean language sql security invoker set search_path = '' as $$ select private.public_consume_token(p_jti, p_exp) $$;
create function public.public_rate_limit(p_key text, p_window_seconds int, p_max int) returns table (allowed boolean, retry_after int) language sql security invoker set search_path = '' as $$ select * from private.rate_limit_hit(p_key, p_window_seconds, p_max) $$;

revoke all on function private.public_catalog(text), private.public_busy(uuid, timestamptz, timestamptz), private.public_book(uuid, uuid, timestamptz, text, text, text, text, jsonb, text, text),
  private.public_get_appointment(uuid), private.public_cancel(uuid), private.public_consume_token(text, timestamptz) from public, anon, authenticated;
grant execute on function private.public_catalog(text), private.public_busy(uuid, timestamptz, timestamptz), private.public_book(uuid, uuid, timestamptz, text, text, text, text, jsonb, text, text),
  private.public_get_appointment(uuid), private.public_cancel(uuid), private.public_consume_token(text, timestamptz), private.rate_limit_hit(text, int, int) to service_role;
revoke all on function public.public_catalog(text), public.public_busy(uuid, timestamptz, timestamptz), public.public_book(uuid, uuid, timestamptz, text, text, text, text, jsonb, text, text),
  public.public_get_appointment(uuid), public.public_cancel(uuid), public.public_consume_token(text, timestamptz), public.public_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.public_catalog(text), public.public_busy(uuid, timestamptz, timestamptz), public.public_book(uuid, uuid, timestamptz, text, text, text, text, jsonb, text, text),
  public.public_get_appointment(uuid), public.public_cancel(uuid), public.public_consume_token(text, timestamptz), public.public_rate_limit(text, int, int) to service_role;
