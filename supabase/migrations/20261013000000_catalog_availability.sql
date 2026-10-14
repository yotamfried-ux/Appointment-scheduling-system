-- Stage 3: catalog + availability (docs/03 §5, docs/04 CAT/AVL). Forward-only.
create extension if not exists btree_gist with schema extensions;

-- ------------------------------------------------------------------ tables
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null default 'business' check (kind in ('business','staff','room')),
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index resources_business_idx on public.resources (business_id);
-- exactly one default resource ("the business itself") per business
create unique index resources_one_default on public.resources (business_id) where is_default;

create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text check (description is null or char_length(description) <= 300),
  duration_minutes int not null check (duration_minutes between 5 and 480),
  buffer_minutes int not null default 0 check (buffer_minutes between 0 and 120),
  price_cents int not null check (price_cents between 0 and 10000000),
  currency text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  capacity int not null default 1 check (capacity between 1 and 100),
  requires_approval boolean,           -- null = follow the business default
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index services_business_idx on public.services (business_id, active, position);
create unique index services_active_name on public.services (business_id, lower(btrim(name))) where active;
create trigger services_touch before update on public.services for each row execute function private.touch_updated_at();

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  resource_id uuid not null references public.resources (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),   -- 0 = Sunday
  start_minute smallint not null check (start_minute between 0 and 1439),
  end_minute smallint not null check (end_minute between 1 and 1440),
  check (start_minute < end_minute),
  -- a resource can never have two overlapping windows on the same weekday (enforced by the database, not the UI)
  exclude using gist (resource_id with =, weekday with =, int4range(start_minute::int, end_minute::int) with &&)
);
create index availability_rules_business_idx on public.availability_rules (business_id, resource_id, weekday);

create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  resource_id uuid not null references public.resources (id) on delete cascade,
  on_date date not null,
  kind text not null check (kind in ('closed','open')),
  start_minute smallint check (start_minute between 0 and 1439),
  end_minute smallint check (end_minute between 1 and 1440),
  note text check (note is null or char_length(note) <= 120),
  created_at timestamptz not null default now(),
  check ((start_minute is null) = (end_minute is null)),
  check (start_minute is null or start_minute < end_minute),
  check (kind = 'closed' or start_minute is not null)           -- a special opening needs hours
);
create index availability_exceptions_business_idx on public.availability_exceptions (business_id, resource_id, on_date);

-- ------------------------------------------------------------------ RLS (members read, admins write)
alter table public.resources enable row level security;               alter table public.resources force row level security;
alter table public.services enable row level security;                alter table public.services force row level security;
alter table public.availability_rules enable row level security;     alter table public.availability_rules force row level security;
alter table public.availability_exceptions enable row level security; alter table public.availability_exceptions force row level security;

create policy resources_select on public.resources for select to authenticated using (private.is_member(business_id, 'staff'));
create policy resources_update on public.resources for update to authenticated using (private.is_member(business_id, 'admin')) with check (private.is_member(business_id, 'admin'));

create policy services_select on public.services for select to authenticated using (private.is_member(business_id, 'staff'));
create policy services_insert on public.services for insert to authenticated with check (private.is_member(business_id, 'admin'));
create policy services_update on public.services for update to authenticated using (private.is_member(business_id, 'admin')) with check (private.is_member(business_id, 'admin'));
create policy services_delete on public.services for delete to authenticated using (private.is_member(business_id, 'admin'));

create policy rules_select on public.availability_rules for select to authenticated using (private.is_member(business_id, 'staff'));
create policy rules_insert on public.availability_rules for insert to authenticated with check (private.is_member(business_id, 'admin'));
create policy rules_update on public.availability_rules for update to authenticated using (private.is_member(business_id, 'admin')) with check (private.is_member(business_id, 'admin'));
create policy rules_delete on public.availability_rules for delete to authenticated using (private.is_member(business_id, 'admin'));

create policy exceptions_select on public.availability_exceptions for select to authenticated using (private.is_member(business_id, 'staff'));
create policy exceptions_insert on public.availability_exceptions for insert to authenticated with check (private.is_member(business_id, 'admin'));
create policy exceptions_update on public.availability_exceptions for update to authenticated using (private.is_member(business_id, 'admin')) with check (private.is_member(business_id, 'admin'));
create policy exceptions_delete on public.availability_exceptions for delete to authenticated using (private.is_member(business_id, 'admin'));

grant select on public.resources to authenticated;
grant update (name, active) on public.resources to authenticated;   -- kind / is_default / business_id are immutable from the client
grant select, delete on public.services, public.availability_rules, public.availability_exceptions to authenticated;
-- business_id is never writable after insert: it is set once by INSERT and not in the UPDATE column lists.
grant insert (business_id, name, description, duration_minutes, buffer_minutes, price_cents, currency, capacity, requires_approval, position, active) on public.services to authenticated;
grant update (name, description, duration_minutes, buffer_minutes, price_cents, currency, capacity, requires_approval, position, active) on public.services to authenticated;
grant insert (business_id, resource_id, weekday, start_minute, end_minute) on public.availability_rules to authenticated;
grant update (weekday, start_minute, end_minute) on public.availability_rules to authenticated;
grant insert (business_id, resource_id, on_date, kind, start_minute, end_minute, note) on public.availability_exceptions to authenticated;
grant update (on_date, kind, start_minute, end_minute, note) on public.availability_exceptions to authenticated;

-- A row's resource must belong to the same business (no cross-tenant FK smuggling).
create function private.assert_same_business() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.resources r where r.id = new.resource_id and r.business_id = new.business_id) then
    raise exception 'resource_mismatch' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger rules_same_business before insert or update on public.availability_rules for each row execute function private.assert_same_business();
create trigger exceptions_same_business before insert or update on public.availability_exceptions for each row execute function private.assert_same_business();

-- ------------------------------------------------------------------ business creation now writes the whole catalog atomically
drop function public.create_business(text, text, text, text, jsonb);
drop function private.create_business_impl(text, text, text, text, jsonb);

create function private.write_catalog(p_business uuid, p_resource uuid, p_services jsonb, p_hours jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare s jsonb; d jsonb; w jsonb; pos int := 0;
begin
  if jsonb_typeof(p_services) is distinct from 'array' or jsonb_array_length(p_services) not between 1 and 30 then
    raise exception 'invalid_services' using errcode = '23514';
  end if;
  if jsonb_typeof(p_hours) is distinct from 'array' then raise exception 'invalid_hours' using errcode = '23514'; end if;
  for s in select * from jsonb_array_elements(p_services) loop
    insert into public.services (business_id, name, duration_minutes, price_cents, position)
    values (p_business, s->>'name', (s->>'durationMinutes')::int, ((s->>'priceNis')::int) * 100, pos);
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

create function private.create_business_impl(p_name text, p_kind text, p_phone text, p_slug text, p_services jsonb, p_hours jsonb)
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
  -- One transaction: the business, its owner, the default resource, services and weekly hours exist together or not at all (ACC-01).
  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;
  insert into public.businesses (slug, name, kind, phone, created_by)
  values (v_slug, btrim(p_name), p_kind, p_phone, v_uid) returning * into v_row;
  insert into public.business_members (business_id, user_id, role) values (v_row.id, v_uid, 'owner');
  insert into public.resources (business_id, name, kind, is_default) values (v_row.id, btrim(p_name), 'business', true) returning id into v_resource;
  perform private.write_catalog(v_row.id, v_resource, p_services, p_hours);
  perform private.audit_write(v_row.id, 'business.created', 'business', v_row.id::text, jsonb_build_object('kind', p_kind));
  perform private.enqueue_event(v_row.id, 'BusinessCreated', jsonb_build_object('slug', v_slug), 'created');
  return v_row;
exception when unique_violation then
  raise exception 'slug_taken' using errcode = 'P0001';
end $$;
revoke all on function private.create_business_impl(text, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function private.create_business_impl(text, text, text, text, jsonb, jsonb) to authenticated;

create function public.create_business(p_name text, p_kind text, p_phone text, p_slug text, p_services jsonb, p_hours jsonb)
returns public.businesses language sql security invoker set search_path = '' as $$
  select * from private.create_business_impl(p_name, p_kind, p_phone, p_slug, p_services, p_hours)
$$;
revoke all on function public.create_business(text, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_business(text, text, text, text, jsonb, jsonb) to authenticated;

-- ------------------------------------------------------------------ weekly hours: atomic replace
-- Logic lives in private (SECURITY DEFINER) behind an explicit admin check; the public wrapper is a thin SECURITY INVOKER.
-- (audit_write is NOT granted to clients: it would let any user forge audit rows for any business.)
create function private.replace_weekly_hours_impl(p_business uuid, p_hours jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_resource uuid; d jsonb; w jsonb; n int := 0;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not private.is_member(p_business, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into v_resource from public.resources where business_id = p_business and is_default;
  if v_resource is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_hours) is distinct from 'array' then raise exception 'invalid_hours' using errcode = '23514'; end if;
  delete from public.availability_rules where business_id = p_business and resource_id = v_resource;
  for d in select * from jsonb_array_elements(p_hours) loop
    if (d->>'open')::boolean then
      for w in select * from jsonb_array_elements(d->'windows') loop
        insert into public.availability_rules (business_id, resource_id, weekday, start_minute, end_minute)
        values (p_business, v_resource, (d->>'weekday')::smallint,
                (substr(w->>'from', 1, 2)::int * 60 + substr(w->>'from', 4, 2)::int),
                (substr(w->>'to', 1, 2)::int * 60 + substr(w->>'to', 4, 2)::int));
        n := n + 1;
      end loop;
    end if;
  end loop;
  perform private.audit_write(p_business, 'availability.replaced', 'availability_rules', p_business::text, jsonb_build_object('windows', n));
  return n;
end $$;
revoke all on function private.replace_weekly_hours_impl(uuid, jsonb) from public, anon;
grant execute on function private.replace_weekly_hours_impl(uuid, jsonb) to authenticated;

create function public.replace_weekly_hours(p_business uuid, p_hours jsonb) returns int
language sql security invoker set search_path = '' as $$
  select private.replace_weekly_hours_impl(p_business, p_hours)
$$;
revoke all on function public.replace_weekly_hours(uuid, jsonb) from public, anon;
grant execute on function public.replace_weekly_hours(uuid, jsonb) to authenticated;
