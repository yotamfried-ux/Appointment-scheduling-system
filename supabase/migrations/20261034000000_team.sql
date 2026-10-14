-- Stage 16 (docs/plans/stage-16-team.md): several people per business, each with their own calendar. Customers pick "whoever is free" or a person. Staff do not sign in.
-- Forward-only. A business with one person behaves exactly as before: every function below falls back to "all active people" = that one person.
-- The old single-person entry points (public_book, create_manual_appointment_impl) stay as thin wrappers so nothing that already calls them changes.

-- ------------------------------------------------------------------ people (resources)
alter table public.resources add column position int not null default 0;
update public.resources r set position = x.rn
  from (select id, (row_number() over (partition by business_id order by is_default desc, created_at, id) - 1)::int as rn from public.resources) x
 where x.id = r.id;
create unique index resources_active_name on public.resources (business_id, lower(btrim(name))) where active;   -- two active people cannot share a name (the public sees names)

-- T13 bounds + T8: at most 30 people, and the last active person cannot be switched off.
create function private.resources_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.resources where business_id = new.business_id) >= 30 then raise exception 'team_limit' using errcode = 'P0001'; end if;
    return new;
  end if;
  if old.active and not new.active
     and not exists (select 1 from public.resources r where r.business_id = new.business_id and r.id <> new.id and r.active) then
    raise exception 'last_active_person' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger resources_guard before insert or update on public.resources for each row execute function private.resources_guard();

-- ------------------------------------------------------------------ which person can do which service (T2): no rows for a service = everybody
create table public.service_staff (
  service_id uuid not null references public.services (id) on delete cascade,
  resource_id uuid not null references public.resources (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  primary key (service_id, resource_id)
);
create index service_staff_business_idx on public.service_staff (business_id, service_id);
create index service_staff_resource_idx on public.service_staff (resource_id);
alter table public.service_staff enable row level security;  alter table public.service_staff force row level security;
create policy service_staff_select on public.service_staff for select to authenticated using (private.is_member(business_id, 'staff'));
grant select on public.service_staff to authenticated;
grant select on public.service_staff to service_role;     -- writes only through set_service_staff (audited)

create function private.service_staff_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.services s where s.id = new.service_id and s.business_id = new.business_id)
     or not exists (select 1 from public.resources r where r.id = new.resource_id and r.business_id = new.business_id) then
    raise exception 'tenant_mismatch' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger service_staff_guard before insert or update on public.service_staff for each row execute function private.service_staff_guard();

-- ------------------------------------------------------------------ business-wide closures (T9): an exception without a person applies to everybody
create or replace function private.assert_same_business() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.resource_id is null then return new; end if;     -- only availability_exceptions may be business-wide (rules keep NOT NULL)
  if not exists (select 1 from public.resources r where r.id = new.resource_id and r.business_id = new.business_id) then
    raise exception 'resource_mismatch' using errcode = 'P0001';
  end if;
  return new;
end $$;
alter table public.availability_exceptions alter column resource_id drop not null;
update public.availability_exceptions set resource_id = null;     -- until now an exception meant "the business"

-- ------------------------------------------------------------------ appointments remember whether the customer named the person (T5/T6)
alter table public.appointments add column resource_chosen boolean not null default false;

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
  if new.business_id <> old.business_id or (not v_move and new.resource_id <> old.resource_id) or new.customer_id <> old.customer_id or (not v_move and new.service_id <> old.service_id)
     or (not v_move and (new.starts_at <> old.starts_at or new.ends_at <> old.ends_at or new.blocked_until <> old.blocked_until or new.rescheduled_count <> old.rescheduled_count))
     or (not v_move and new.resource_chosen <> old.resource_chosen)
     or new.reference <> old.reference
     or (not v_move and (new.service_snapshot <> old.service_snapshot or new.price_cents <> old.price_cents or new.out_of_availability <> old.out_of_availability))
     or new.location <> old.location or new.source <> old.source
     or (not v_anon and (new.intake <> old.intake or new.owner_note is distinct from old.owner_note))
     or (new.contact_email is distinct from old.contact_email and not (v_anon and new.contact_email is null)) then
    raise exception 'appointment_immutable' using errcode = 'P0001';
  end if;
  if v_move and new.resource_id <> old.resource_id and not exists (select 1 from public.resources r where r.id = new.resource_id and r.business_id = new.business_id) then
    raise exception 'tenant_mismatch' using errcode = 'P0001';
  end if;
  if new.status <> old.status and not (
       (old.status = 'pending' and new.status in ('confirmed','cancelled_by_business','cancelled_by_customer'))
    or (old.status = 'confirmed' and new.status in ('completed','no_show','cancelled_by_customer','cancelled_by_business','cancellation_requested'))
    or (old.status = 'cancellation_requested' and new.status in ('cancelled_by_customer','cancelled_by_business','confirmed'))
    or (old.status = 'completed' and new.status = 'no_show')
    or (old.status = 'no_show' and new.status = 'completed')
    or (v_move and old.status = 'confirmed' and new.status = 'pending')
  ) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ------------------------------------------------------------------ waitlist offers hold a PERSON's slot (T10)
alter table public.waitlist_offers add column resource_id uuid references public.resources (id) on delete cascade;
update public.waitlist_offers o set resource_id = (select r.id from public.resources r where r.business_id = o.business_id and r.is_default);
create function private.waitlist_offers_default_person() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.resource_id is null then select r.id into new.resource_id from public.resources r where r.business_id = new.business_id and r.is_default; end if;   -- a one-person caller that names nobody means "the" person
  return new;
end $$;
create trigger waitlist_offers_default_person before insert on public.waitlist_offers for each row execute function private.waitlist_offers_default_person();
alter table public.waitlist_offers alter column resource_id set not null;
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.waitlist_offers'::regclass and contype = 'x' loop
    execute format('alter table public.waitlist_offers drop constraint %I', c);
  end loop;
end $$;
alter table public.waitlist_offers add constraint waitlist_offers_one_live_per_person
  exclude using gist (resource_id with =, tstzrange(slot_starts_at, blocked_until, '[)') with &&) where (status = 'pending');
create index waitlist_offers_resource_idx on public.waitlist_offers (business_id, resource_id);

-- ------------------------------------------------------------------ helpers (private, never exposed)
-- Can this person do this service? (same business, and either the service has no restriction or the person is listed)
create function private.resource_can_do(p_resource uuid, p_service uuid) returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.resources r join public.services s on s.business_id = r.business_id where r.id = p_resource and s.id = p_service)
     and (not exists (select 1 from public.service_staff x where x.service_id = p_service)
          or exists (select 1 from public.service_staff x where x.service_id = p_service and x.resource_id = p_resource))
$$;

-- The ordered list of people to try for a booking (T4/T5). With p_only the caller's order is kept and anyone not active / not able to do the service is dropped
-- (the database never trusts a list it was handed). Without it: everybody eligible, fewest appointments that local day first, then position.
create function private.team_candidates(p_business uuid, p_service uuid, p_at timestamptz, p_only uuid[] default null) returns uuid[]
language plpgsql stable set search_path = '' as $$
declare v_tz text; v_day date; v_out uuid[];
begin
  select timezone into v_tz from public.businesses where id = p_business;
  if v_tz is null then return '{}'; end if;
  if p_only is not null and cardinality(p_only) > 0 then
    select coalesce(array_agg(r.id order by o.ord), '{}') into v_out
      from unnest(p_only) with ordinality o(id, ord) join public.resources r on r.id = o.id
     where r.business_id = p_business and r.active and private.resource_can_do(r.id, p_service);
    return v_out;
  end if;
  v_day := (p_at at time zone v_tz)::date;
  select coalesce(array_agg(r.id order by (select count(*) from public.appointments a
            where a.resource_id = r.id and a.status in ('pending','confirmed','cancellation_requested') and (a.starts_at at time zone v_tz)::date = v_day), r.position, r.id), '{}') into v_out
    from public.resources r where r.business_id = p_business and r.active and private.resource_can_do(r.id, p_service);
  return v_out;
end $$;

-- ------------------------------------------------------------------ owner RPCs (admin or owner; audited) — T13
create function private.create_staff_impl(p_business uuid, p_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not private.is_member(p_business, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 80 then raise exception 'invalid_name' using errcode = '23514'; end if;
  begin
    insert into public.resources (business_id, name, kind, position)
    values (p_business, v_name, 'staff', coalesce((select max(position) + 1 from public.resources where business_id = p_business), 0)) returning id into v_id;
  exception when unique_violation then raise exception 'name_taken' using errcode = 'P0001';
  end;
  perform private.audit_write(p_business, 'staff.created', 'resource', v_id::text, '{}'::jsonb);
  return v_id;
end $$;

-- rename and/or (de)activate. Returns how many future appointments the person still has, so the owner is told (T8: nothing moves silently).
create function private.update_staff_impl(p_resource uuid, p_name text default null, p_active boolean default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.resources; v_future int;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into r from public.resources where id = p_resource for update;
  if not found or not private.is_member(r.business_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_name is not null and char_length(btrim(p_name)) not between 1 and 80 then raise exception 'invalid_name' using errcode = '23514'; end if;
  begin
    update public.resources set name = coalesce(btrim(p_name), name), active = coalesce(p_active, active) where id = p_resource returning * into r;
  exception when unique_violation then raise exception 'name_taken' using errcode = 'P0001';
  end;
  select count(*)::int into v_future from public.appointments a where a.resource_id = r.id and a.starts_at > now() and a.status in ('pending','confirmed','cancellation_requested');
  perform private.audit_write(r.business_id, 'staff.updated', 'resource', r.id::text, jsonb_build_object('active', r.active, 'renamed', p_name is not null));
  return jsonb_build_object('id', r.id, 'name', r.name, 'active', r.active, 'futureAppointments', v_future);
end $$;

-- a service is restricted to the listed people; an empty list lifts the restriction (T2)
create function private.set_service_staff_impl(p_service uuid, p_resources uuid[]) returns int language plpgsql security definer set search_path = '' as $$
declare s public.services; v_n int;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into s from public.services where id = p_service for update;
  if not found or not private.is_member(s.business_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_resources is not null and cardinality(p_resources) > 30 then raise exception 'invalid_staff' using errcode = '23514'; end if;
  if p_resources is not null and exists (select 1 from unnest(p_resources) u(id) where not exists (select 1 from public.resources r where r.id = u.id and r.business_id = s.business_id)) then
    raise exception 'resource_mismatch' using errcode = 'P0001';                            -- another business' person, or one that does not exist
  end if;
  delete from public.service_staff where service_id = s.id;
  if p_resources is not null and cardinality(p_resources) > 0 then
    insert into public.service_staff (service_id, resource_id, business_id) select s.id, x, s.business_id from (select distinct unnest(p_resources) as x) d;
  end if;
  select count(*)::int into v_n from public.service_staff where service_id = s.id;
  perform private.audit_write(s.business_id, 'service.staff_set', 'service', s.id::text, jsonb_build_object('people', v_n));
  return v_n;
end $$;

-- the one place that rewrites a person's weekly hours (callers check rights and audit)
create function private.write_hours(p_business uuid, p_resource uuid, p_hours jsonb) returns int language plpgsql set search_path = '' as $$
declare d jsonb; w jsonb; n int := 0;
begin
  if jsonb_typeof(p_hours) is distinct from 'array' then raise exception 'invalid_hours' using errcode = '23514'; end if;
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

-- one person's weekly hours (same JSON as replace_weekly_hours)
create function private.set_staff_hours_impl(p_resource uuid, p_hours jsonb) returns int language plpgsql security definer set search_path = '' as $$
declare r public.resources; n int;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into r from public.resources where id = p_resource;
  if not found or not private.is_member(r.business_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  n := private.write_hours(r.business_id, r.id, p_hours);
  perform private.audit_write(r.business_id, 'staff.hours_set', 'resource', r.id::text, jsonb_build_object('windows', n));
  return n;
end $$;

-- the single-person call keeps working (and keeps its audit action): it sets the hours of the default person
create or replace function private.replace_weekly_hours_impl(p_business uuid, p_hours jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_resource uuid; n int;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not private.is_member(p_business, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into v_resource from public.resources where business_id = p_business and is_default;
  if v_resource is null then raise exception 'forbidden' using errcode = '42501'; end if;
  n := private.write_hours(p_business, v_resource, p_hours);
  perform private.audit_write(p_business, 'availability.replaced', 'availability_rules', p_business::text, jsonb_build_object('windows', n));
  return n;
end $$;

create function public.create_staff(p_business uuid, p_name text) returns uuid language sql security invoker set search_path = '' as $$ select private.create_staff_impl(p_business, p_name) $$;
create function public.update_staff(p_resource uuid, p_name text default null, p_active boolean default null) returns jsonb language sql security invoker set search_path = '' as $$ select private.update_staff_impl(p_resource, p_name, p_active) $$;
create function public.set_service_staff(p_service uuid, p_resources uuid[]) returns int language sql security invoker set search_path = '' as $$ select private.set_service_staff_impl(p_service, p_resources) $$;
create function public.set_staff_hours(p_resource uuid, p_hours jsonb) returns int language sql security invoker set search_path = '' as $$ select private.set_staff_hours_impl(p_resource, p_hours) $$;
revoke all on function private.create_staff_impl(uuid, text), private.update_staff_impl(uuid, text, boolean), private.set_service_staff_impl(uuid, uuid[]), private.set_staff_hours_impl(uuid, jsonb),
  public.create_staff(uuid, text), public.update_staff(uuid, text, boolean), public.set_service_staff(uuid, uuid[]), public.set_staff_hours(uuid, jsonb) from public, anon;
grant execute on function private.create_staff_impl(uuid, text), private.update_staff_impl(uuid, text, boolean), private.set_service_staff_impl(uuid, uuid[]), private.set_staff_hours_impl(uuid, jsonb),
  public.create_staff(uuid, text), public.update_staff(uuid, text, boolean), public.set_service_staff(uuid, uuid[]), public.set_staff_hours(uuid, jsonb) to authenticated;
revoke all on function private.resources_guard(), private.service_staff_guard(), private.write_hours(uuid, uuid, jsonb), private.waitlist_offers_default_person(), private.resource_can_do(uuid, uuid), private.team_candidates(uuid, uuid, timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function private.resource_can_do(uuid, uuid), private.team_candidates(uuid, uuid, timestamptz, uuid[]) to service_role;

-- ------------------------------------------------------------------ public side
-- busy list now names the person
drop function public.public_busy(uuid, timestamptz, timestamptz);
drop function private.public_busy(uuid, timestamptz, timestamptz);
create function private.public_busy(p_business uuid, p_from timestamptz, p_to timestamptz)
returns table (starts_at timestamptz, blocked_until timestamptz, resource_id uuid) language sql stable security definer set search_path = '' as $$
  select a.starts_at, a.blocked_until, a.resource_id from public.appointments a
  where a.business_id = p_business and a.status in ('pending','confirmed','cancellation_requested')
    and a.starts_at < p_to and a.blocked_until > p_from
  union all
  select o.slot_starts_at, o.blocked_until, o.resource_id from public.waitlist_offers o
  where o.business_id = p_business and o.status = 'pending' and o.expires_at > now()
    and o.slot_starts_at < p_to and o.blocked_until > p_from
$$;
create function public.public_busy(p_business uuid, p_from timestamptz, p_to timestamptz) returns table (starts_at timestamptz, blocked_until timestamptz, resource_id uuid)
language sql stable security invoker set search_path = '' as $$ select * from private.public_busy(p_business, p_from, p_to) $$;
revoke all on function private.public_busy(uuid, timestamptz, timestamptz), public.public_busy(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function private.public_busy(uuid, timestamptz, timestamptz), public.public_busy(uuid, timestamptz, timestamptz) to service_role;

-- catalog: people (names are public, T11), who can do what, hours and closures per person. A one-person business returns one person.
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
    return jsonb_build_object('redirect', b.slug);          -- old link keeps working (ACC-07)
  end if;
  if b.published_at is null then return null; end if;      -- unknown and unpublished look identical (BKG-11, no enumeration)
  return jsonb_build_object(
    'business', jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'kind', b.kind, 'timezone', b.timezone, 'address', coalesce(b.address, ''),
      'requiresApproval', b.requires_approval, 'cancelUntilHours', b.cancel_until_hours, 'minNoticeMinutes', b.min_notice_minutes, 'horizonDays', b.booking_horizon_days, 'waitlistEnabled', b.waitlist_enabled and private.entitlement_can(b.id, 'waitlist'),
      'acceptingBookings', private.billing_accepts(b.id)),
    'team', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by r.position, r.id) from public.resources r where r.business_id = b.id and r.active), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', coalesce(s.description, ''), 'durationMinutes', s.duration_minutes,
        'bufferMinutes', s.buffer_minutes, 'priceCents', s.price_cents, 'priceMode', s.price_mode, 'requiresApproval', s.requires_approval,
        'staffIds', (select jsonb_agg(x.resource_id order by x.resource_id) from public.service_staff x join public.resources rr on rr.id = x.resource_id and rr.active where x.service_id = s.id)) order by s.position, s.created_at)
        from public.services s where s.business_id = b.id and s.active and s.capacity = 1), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('resourceId', r.resource_id, 'weekday', r.weekday, 'startMinute', r.start_minute, 'endMinute', r.end_minute))
        from public.availability_rules r join public.resources rr on rr.id = r.resource_id and rr.active where r.business_id = b.id), '[]'::jsonb),
    'exceptions', coalesce((select jsonb_agg(jsonb_build_object('resourceId', e.resource_id, 'date', e.on_date, 'kind', e.kind, 'startMinute', e.start_minute, 'endMinute', e.end_minute))
        from public.availability_exceptions e where e.business_id = b.id and e.on_date >= (current_date - 2)
          and (e.resource_id is null or exists (select 1 from public.resources rr where rr.id = e.resource_id and rr.active))), '[]'::jsonb)
  );
end $$;

-- booking with a list of people to try, in order (T4). The exclusion constraint decides; the first person who is really free gets it.
create function private.public_book_team(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_email text, p_location text, p_intake jsonb, p_idem_key text, p_request_hash text,
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

  insert into public.customers (business_id, full_name, phone, email) values (p_business, btrim(p_full_name), p_phone, nullif(btrim(coalesce(p_email, '')), ''))
  on conflict (business_id, phone) do update set full_name = public.customers.full_name   -- BKG-05
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
create function public.public_book_team(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_email text, p_location text, p_intake jsonb, p_idem_key text, p_request_hash text, p_resources uuid[], p_chosen boolean)
returns jsonb language sql security invoker set search_path = '' as $$ select private.public_book_team(p_business, p_service, p_starts_at, p_full_name, p_phone, p_email, p_location, p_intake, p_idem_key, p_request_hash, p_resources, p_chosen) $$;
revoke all on function private.public_book_team(uuid, uuid, timestamptz, text, text, text, text, jsonb, text, text, uuid[], boolean), public.public_book_team(uuid, uuid, timestamptz, text, text, text, text, jsonb, text, text, uuid[], boolean) from public, anon, authenticated;
grant execute on function private.public_book_team(uuid, uuid, timestamptz, text, text, text, text, jsonb, text, text, uuid[], boolean), public.public_book_team(uuid, uuid, timestamptz, text, text, text, text, jsonb, text, text, uuid[], boolean) to service_role;

-- the single-person entry point: everybody eligible, in the default order
create or replace function private.public_book(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_email text, p_location text, p_intake jsonb, p_idem_key text, p_request_hash text)
returns jsonb language sql security definer set search_path = '' as $$
  select private.public_book_team(p_business, p_service, p_starts_at, p_full_name, p_phone, p_email, p_location, p_intake, p_idem_key, p_request_hash, null, false)
$$;

-- ------------------------------------------------------------------ owner books by hand (optionally for a named person)
create function private.create_manual_appointment_team(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_note text, p_out_of_availability boolean, p_resource uuid)
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

  insert into public.customers (business_id, full_name, phone) values (p_business, btrim(p_full_name), p_phone)
  on conflict (business_id, phone) do update set full_name = public.customers.full_name
  returning id into v_cust;

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
create function public.create_manual_appointment_team(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_note text, p_out_of_availability boolean, p_resource uuid)
returns jsonb language sql security invoker set search_path = '' as $$ select private.create_manual_appointment_team(p_business, p_service, p_starts_at, p_full_name, p_phone, p_note, p_out_of_availability, p_resource) $$;
revoke all on function private.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid), public.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid) from public, anon;
grant execute on function private.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid), public.create_manual_appointment_team(uuid, uuid, timestamptz, text, text, text, boolean, uuid) to authenticated;

create or replace function private.create_manual_appointment_impl(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_note text, p_out_of_availability boolean)
returns jsonb language sql security definer set search_path = '' as $$
  select private.create_manual_appointment_team(p_business, p_service, p_starts_at, p_full_name, p_phone, p_note, p_out_of_availability, null)
$$;

-- ------------------------------------------------------------------ waitlist per person (T10)
drop function private.waitlist_offer_for_slot(uuid, timestamptz, timestamptz, uuid, boolean);
create function private.waitlist_offer_for_slot(p_business uuid, p_starts_at timestamptz, p_freed_until timestamptz, p_force_entry uuid default null, p_ignore_auto boolean default false, p_resource uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses; e public.waitlist_entries; s public.services;
  v_offer uuid; v_exp timestamptz; v_local timestamp; v_min int; v_res uuid;
begin
  select * into b from public.businesses where id = p_business and published_at is not null;
  if not found or not b.waitlist_enabled or not private.entitlement_can(p_business, 'waitlist') then return null; end if;                -- BIL-08: no offers without the feature
  if not p_ignore_auto and not b.waitlist_auto_offer then return null; end if;                      -- WLT-06
  if p_starts_at < now() + make_interval(mins => b.min_notice_minutes) then return null; end if;
  if p_resource is not null and exists (select 1 from public.appointments a where a.business_id = p_business and a.resource_id = p_resource and a.status in ('pending','confirmed','cancellation_requested')
             and tstzrange(a.starts_at, a.blocked_until, '[)') && tstzrange(p_starts_at, p_freed_until, '[)')) then return null; end if;   -- the hole must really be free (for that person)
  v_local := p_starts_at at time zone b.timezone;
  v_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  select w.* into e from public.waitlist_entries w join public.services sv on sv.id = w.service_id
   where w.business_id = p_business and w.status = 'waiting' and w.on_date = v_local::date and (p_force_entry is null or w.id = p_force_entry)
     and sv.active and sv.capacity = 1
     and sv.duration_minutes + sv.buffer_minutes <= extract(epoch from (p_freed_until - p_starts_at)) / 60
     and (w.from_minute is null or (v_min >= w.from_minute and v_min + sv.duration_minutes <= w.to_minute))
     and (p_resource is null or private.resource_can_do(p_resource, sv.id))
     and not exists (select 1 from public.waitlist_offers o where o.entry_id = w.id and o.slot_starts_at = p_starts_at)
   order by w.created_at, w.id                                                                         -- WLT-01: first come, first served
   limit 1 for update of w skip locked;
  if not found then return null; end if;
  select * into s from public.services where id = e.service_id;
  if p_resource is not null then
    v_res := p_resource;
  else
    -- the caller did not say whose slot it was: any active person who can do the service and is free for the whole offered stretch
    select r.id into v_res from public.resources r
     where r.business_id = p_business and r.active and private.resource_can_do(r.id, s.id)
       and not exists (select 1 from public.appointments a where a.resource_id = r.id and a.status in ('pending','confirmed','cancellation_requested')
                       and tstzrange(a.starts_at, a.blocked_until, '[)') && tstzrange(p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes + s.buffer_minutes), '[)'))
     order by r.position, r.id limit 1;
    if v_res is null then return null; end if;
  end if;
  if not exists (select 1 from public.resources r where r.id = v_res and r.business_id = p_business and r.active) then return null; end if;
  v_exp := least(now() + make_interval(mins => b.waitlist_offer_minutes), p_starts_at - interval '10 minutes');
  if v_exp <= now() + interval '1 minute' then return null; end if;
  begin
    insert into public.waitlist_offers (business_id, resource_id, entry_id, slot_starts_at, slot_ends_at, blocked_until, freed_until, expires_at)
    values (p_business, v_res, e.id, p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes), p_starts_at + make_interval(mins => s.duration_minutes + s.buffer_minutes), p_freed_until, v_exp)
    returning id into v_offer;
  exception when exclusion_violation then return null;                                                 -- another live offer already holds this person's time
  end;
  update public.waitlist_entries set status = 'offered' where id = e.id;
  perform private.notif_enqueue_offer(v_offer, 'waitlist_offer');
  return v_offer;
end $$;
revoke all on function private.waitlist_offer_for_slot(uuid, timestamptz, timestamptz, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function private.waitlist_offer_for_slot(uuid, timestamptz, timestamptz, uuid, boolean, uuid) to service_role;

-- accept: the offer carries the person
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

create or replace function private.waitlist_decline_impl(p_offer uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.waitlist_offers;
begin
  select * into o from public.waitlist_offers where id = p_offer for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if o.status <> 'pending' then return jsonb_build_object('outcome', 'not_pending', 'status', o.status); end if;
  update public.waitlist_offers set status = 'declined', resolved_at = now() where id = o.id;
  update public.waitlist_entries set status = 'waiting' where id = o.entry_id and status = 'offered';
  perform private.waitlist_offer_for_slot(o.business_id, o.slot_starts_at, o.freed_until, null, false, o.resource_id);
  return jsonb_build_object('outcome', 'declined');
end $$;

create or replace function private.waitlist_leave_impl(p_entry uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.waitlist_entries; o public.waitlist_offers;
begin
  select * into e from public.waitlist_entries where id = p_entry for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if e.status not in ('waiting','offered') then return jsonb_build_object('outcome', 'not_active', 'status', e.status); end if;
  update public.waitlist_entries set status = 'cancelled' where id = e.id;
  for o in select * from public.waitlist_offers where entry_id = e.id and status = 'pending' for update loop
    update public.waitlist_offers set status = 'declined', resolved_at = now() where id = o.id;
    perform private.waitlist_offer_for_slot(o.business_id, o.slot_starts_at, o.freed_until, null, false, o.resource_id);
  end loop;
  return jsonb_build_object('outcome', 'left');
end $$;

create or replace function private.waitlist_sweep_impl(p_now timestamptz default now()) returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.waitlist_offers; v_expired int := 0; v_lost int := 0; v_past int := 0; v_elsewhere int := 0;
begin
  for o in select * from public.waitlist_offers where status = 'pending' and expires_at <= p_now order by expires_at for update skip locked loop
    update public.waitlist_offers set status = 'expired', resolved_at = p_now where id = o.id;
    update public.waitlist_entries set status = 'waiting' where id = o.entry_id and status = 'offered';
    perform private.notif_enqueue_offer(o.id, 'waitlist_offer_expired');                                      -- the original recipient is told
    perform private.waitlist_offer_for_slot(o.business_id, o.slot_starts_at, o.freed_until, null, false, o.resource_id);   -- and the slot moves on
    v_expired := v_expired + 1;
  end loop;
  for o in select wo.* from public.waitlist_offers wo where wo.status = 'pending' and exists (
             select 1 from public.appointments a where a.resource_id = wo.resource_id and a.status in ('pending','confirmed','cancellation_requested')
             and tstzrange(a.starts_at, a.blocked_until, '[)') && tstzrange(wo.slot_starts_at, wo.blocked_until, '[)')) for update skip locked loop
    update public.waitlist_offers set status = 'lost', resolved_at = p_now where id = o.id;                   -- someone booked it meanwhile
    update public.waitlist_entries set status = 'waiting' where id = o.entry_id and status = 'offered';
    v_lost := v_lost + 1;
  end loop;
  update public.waitlist_entries w set status = 'cancelled' from public.businesses b
   where b.id = w.business_id and w.status in ('waiting','offered') and w.on_date < (p_now at time zone b.timezone)::date;
  get diagnostics v_past = row_count;
  update public.waitlist_entries w set status = 'booked' from public.businesses b                              -- WLT-05: already booked the same thing
   where b.id = w.business_id and w.status = 'waiting' and exists (
     select 1 from public.appointments a where a.customer_id = w.customer_id and a.service_id = w.service_id
       and a.status in ('pending','confirmed') and (a.starts_at at time zone b.timezone)::date = w.on_date);
  get diagnostics v_elsewhere = row_count;
  return jsonb_build_object('expired', v_expired, 'lost', v_lost, 'pastCancelled', v_past, 'bookedElsewhere', v_elsewhere);
end $$;

-- cancellations free THAT person's slot
create or replace function private.public_cancel(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.appointments; b public.businesses;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  select * into b from public.businesses where id = a.business_id;
  if a.status not in ('pending','confirmed') then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
  if a.moved_by_business_at is null and now() > a.starts_at - make_interval(hours => b.cancel_until_hours) then raise exception 'too_late' using errcode = 'P0001'; end if;   -- RSC-04
  update public.appointments set status = 'cancelled_by_customer', cancelled_at = now() where id = p_id;
  perform private.enqueue_event(a.business_id, 'AppointmentCancelled', jsonb_build_object('appointmentId', a.id, 'by', 'customer'), 'cancel:' || a.id::text);
  perform private.waitlist_offer_for_slot(a.business_id, a.starts_at, a.blocked_until, null, false, a.resource_id);
  return jsonb_build_object('id', a.id, 'status', 'cancelled_by_customer');
end $$;

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
  if v_to in ('confirmed', 'cancelled_by_business', 'cancelled_by_customer') then
    perform private.enqueue_event(a.business_id, 'AppointmentStatusChanged', jsonb_build_object('appointmentId', p_id, 'action', p_action, 'to', v_to), 'st:' || p_id::text || ':' || p_action);
  end if;
  if v_to like 'cancelled%' then
    perform private.waitlist_offer_for_slot(a.business_id, a.starts_at, a.blocked_until, null, false, a.resource_id);                 -- WLT-01
  end if;
  return jsonb_build_object('id', p_id, 'status', v_to);
end $$;

-- ------------------------------------------------------------------ customer reschedule (T6): same person; "whoever is free" may switch, a named person never
create or replace function private.public_reschedule(p_id uuid, p_new_start timestamptz, p_new_service uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.appointments; b public.businesses; s public.services;
  v_old_start timestamptz; v_old_blocked timestamptz; v_old_res uuid; v_changed boolean := false; v_dur int; v_buf int; v_status text;
  v_cands uuid[]; v_res uuid; v_done boolean := false;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  select * into b from public.businesses where id = a.business_id;
  if a.status not in ('pending','confirmed') then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
  if now() > a.starts_at - make_interval(hours => b.cancel_until_hours) then raise exception 'too_late' using errcode = 'P0001'; end if;   -- RSC-02
  if a.rescheduled_count >= 3 then raise exception 'reschedule_limit' using errcode = 'P0001'; end if;
  if p_new_service is not null and p_new_service <> a.service_id then
    if not b.reschedule_service_change then raise exception 'service_change_not_allowed' using errcode = 'P0001'; end if;   -- RSC-03
    select * into s from public.services where id = p_new_service and business_id = a.business_id and active and capacity = 1;
    v_changed := true;
  else
    select * into s from public.services where id = a.service_id and active and capacity = 1;
  end if;
  if not found then raise exception 'service_unavailable' using errcode = 'P0001'; end if;
  if p_new_start = a.starts_at then raise exception 'same_slot' using errcode = 'P0001'; end if;
  if p_new_start < now() + make_interval(mins => b.min_notice_minutes) then raise exception 'slot_in_past' using errcode = 'P0001'; end if;
  if p_new_start > now() + make_interval(days => b.booking_horizon_days) then raise exception 'slot_too_far' using errcode = 'P0001'; end if;
  if v_changed then v_dur := s.duration_minutes; v_buf := s.buffer_minutes; else v_dur := (a.service_snapshot ->> 'durationMinutes')::int; v_buf := (a.service_snapshot ->> 'bufferMinutes')::int; end if;
  -- people to try: the same person first; only if the customer did not name them, anyone else who can do the service
  if a.resource_chosen then
    v_cands := private.team_candidates(a.business_id, s.id, p_new_start, array[a.resource_id]);
  else
    v_cands := private.team_candidates(a.business_id, s.id, p_new_start, array[a.resource_id] || coalesce(private.team_candidates(a.business_id, s.id, p_new_start, null), '{}'));
  end if;
  if cardinality(v_cands) = 0 then raise exception 'slot_taken' using errcode = 'P0001'; end if;
  v_old_start := a.starts_at; v_old_blocked := a.blocked_until; v_old_res := a.resource_id;
  v_status := case when a.status = 'confirmed' and coalesce(s.requires_approval, b.requires_approval) then 'pending' else a.status end;
  perform set_config('app.rescheduling', 'on', true);
  foreach v_res in array v_cands loop
    if exists (select 1 from public.waitlist_offers o where o.resource_id = v_res and o.status = 'pending' and o.expires_at > now()
               and tstzrange(o.slot_starts_at, o.blocked_until, '[)') && tstzrange(p_new_start, p_new_start + make_interval(mins => v_dur + v_buf), '[)')) then
      continue;
    end if;
    begin
      update public.appointments set starts_at = p_new_start, ends_at = p_new_start + make_interval(mins => v_dur), blocked_until = p_new_start + make_interval(mins => v_dur + v_buf),
             rescheduled_count = rescheduled_count + 1, status = v_status, resource_id = v_res,
             service_id = s.id,
             service_snapshot = case when v_changed then jsonb_build_object('name', s.name, 'durationMinutes', s.duration_minutes, 'bufferMinutes', s.buffer_minutes, 'priceCents', s.price_cents) else service_snapshot end,
             price_cents = case when v_changed then s.price_cents else price_cents end
       where id = p_id returning * into a;
      v_done := true;
      exit;
    exception when exclusion_violation or deadlock_detected then null;                              -- the old slot stays; try the next person
    end;
  end loop;
  perform set_config('app.rescheduling', 'off', true);
  if not v_done then raise exception 'slot_taken' using errcode = 'P0001'; end if;
  delete from public.notification_log where appointment_id = p_id and type in ('booking_rescheduled', 'owner_customer_rescheduled', 'reminder') and status in ('queued', 'skipped', 'sent');
  perform private.enqueue_event(a.business_id, 'AppointmentRescheduled', jsonb_build_object('appointmentId', a.id, 'previousStartsAt', v_old_start), 'resched:' || a.id::text || ':' || a.rescheduled_count::text);
  perform private.waitlist_offer_for_slot(a.business_id, v_old_start, v_old_blocked, null, false, v_old_res);                -- the slot just freed goes to the waitlist (WLT-01)
  return jsonb_build_object('id', a.id, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at, 'rescheduledCount', a.rescheduled_count, 'resourceId', a.resource_id);
end $$;

-- ------------------------------------------------------------------ owner moves a booking, optionally to another person (T7)
drop function public.owner_move_appointment(uuid, timestamptz, boolean);
drop function private.owner_move_appointment_impl(uuid, timestamptz, boolean);
create function private.owner_move_appointment_impl(p_id uuid, p_new_start timestamptz, p_out_of_availability boolean default false, p_resource uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.appointments; v_old_start timestamptz; v_old_blocked timestamptz; v_old_res uuid; v_dur int; v_buf int; v_to uuid;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into a from public.appointments where id = p_id for update;
  if not found or not private.is_member(a.business_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if a.status not in ('pending', 'confirmed') then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
  if p_new_start <= now() then raise exception 'slot_in_past' using errcode = 'P0001'; end if;
  v_to := coalesce(p_resource, a.resource_id);
  if v_to is distinct from a.resource_id and not exists (select 1 from public.resources r where r.id = v_to and r.business_id = a.business_id and r.active) then
    raise exception 'resource_mismatch' using errcode = 'P0001';
  end if;
  if v_to is distinct from a.resource_id and not private.resource_can_do(v_to, a.service_id) then raise exception 'service_unavailable' using errcode = 'P0001'; end if;
  if p_new_start = a.starts_at and v_to = a.resource_id then raise exception 'same_slot' using errcode = 'P0001'; end if;
  v_dur := (a.service_snapshot ->> 'durationMinutes')::int; v_buf := (a.service_snapshot ->> 'bufferMinutes')::int;
  v_old_start := a.starts_at; v_old_blocked := a.blocked_until; v_old_res := a.resource_id;
  perform set_config('app.rescheduling', 'on', true);
  begin
    update public.appointments set starts_at = p_new_start, ends_at = p_new_start + make_interval(mins => v_dur), blocked_until = p_new_start + make_interval(mins => v_dur + v_buf),
           resource_id = v_to, resource_chosen = case when v_to <> v_old_res then true else resource_chosen end,
           moved_by_business_at = now(), attendance_confirmed_at = null, out_of_availability = coalesce(p_out_of_availability, false) where id = p_id returning * into a;
  exception when exclusion_violation or deadlock_detected then raise exception 'slot_taken' using errcode = 'P0001';
  end;
  perform set_config('app.rescheduling', 'off', true);
  delete from public.notification_log where appointment_id = p_id and type in ('booking_moved_by_business', 'reminder', 'owner_unconfirmed') and status in ('queued', 'skipped', 'sent');
  perform private.enqueue_event(a.business_id, 'AppointmentMovedByBusiness', jsonb_build_object('appointmentId', a.id, 'previousStartsAt', v_old_start), 'moved:' || a.id::text || ':' || extract(epoch from now())::text);
  perform private.audit_write(a.business_id, 'appointment.moved', 'appointment', a.id::text, jsonb_build_object('from', v_old_start, 'to', a.starts_at, 'fromPerson', v_old_res, 'toPerson', a.resource_id));
  perform private.waitlist_offer_for_slot(a.business_id, v_old_start, v_old_blocked, null, false, v_old_res);
  return jsonb_build_object('id', a.id, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at, 'resourceId', a.resource_id);
end $$;
create function public.owner_move_appointment(p_id uuid, p_new_start timestamptz, p_out_of_availability boolean default false, p_resource uuid default null) returns jsonb language sql security invoker set search_path = '' as $$ select private.owner_move_appointment_impl(p_id, p_new_start, p_out_of_availability, p_resource) $$;
revoke all on function private.owner_move_appointment_impl(uuid, timestamptz, boolean, uuid), public.owner_move_appointment(uuid, timestamptz, boolean, uuid) from public, anon;
grant execute on function private.owner_move_appointment_impl(uuid, timestamptz, boolean, uuid), public.owner_move_appointment(uuid, timestamptz, boolean, uuid) to authenticated;
