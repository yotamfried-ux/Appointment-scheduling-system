-- Stage 2: tenancy core (docs/03 §5, docs/05 §5.1). Forward-only.
-- Pattern: tables are RLS-protected (enabled + forced); sensitive writes go through private.*_impl
-- (SECURITY DEFINER, search_path = '') behind thin public.* SECURITY INVOKER wrappers.

-- authenticated needs USAGE on private only so RLS policies/wrappers can call the specific functions
-- granted below; the schema is not in the Data API's exposed schemas (supabase/config.toml).
grant usage on schema private to authenticated;

-- ------------------------------------------------------------------ helpers
create function private.role_rank(p_role text) returns int
language sql immutable set search_path = '' as $$
  select case p_role when 'owner' then 3 when 'admin' then 2 when 'staff' then 1 else 0 end
$$;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ------------------------------------------------------------------ tables
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  created_at timestamptz not null default now()
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  kind text not null check (kind in ('barber','beauty','trainer','teacher','clinic','other')),
  timezone text not null default 'Asia/Jerusalem',
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 16384),
  published_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint businesses_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 40),
  constraint businesses_slug_not_reserved check (slug <> all (array[
    'admin','api','login','auth','book','app','www','dashboard','settings','design','static','onboarding','privacy','terms','support','help','billing','assets','public','_next'
  ]))
);
create unique index businesses_slug_key on public.businesses (lower(slug));
create trigger businesses_touch before update on public.businesses for each row execute function private.touch_updated_at();

create table public.business_members (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner','admin','staff')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index business_members_user_idx on public.business_members (user_id);

create table public.slug_redirects (
  old_slug text primary key check (old_slug = lower(old_slug)),
  business_id uuid not null references public.businesses (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index slug_redirects_business_idx on public.slug_redirects (business_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  business_id uuid,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_business_idx on public.audit_log (business_id, created_at desc);

create function private.audit_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_update before update or delete on public.audit_log for each row execute function private.audit_immutable();

-- Outbox: side effects (email, calendar, waitlist) are queued here in the same transaction as the change.
create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts int not null default 0,
  last_error text
);
create index domain_events_business_idx on public.domain_events (business_id, created_at);
create unique index domain_events_dedupe_key on public.domain_events (business_id, dedupe_key) where dedupe_key is not null;
create index domain_events_pending_idx on public.domain_events (available_at) where processed_at is null;

create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  run_key text not null,
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  unique (job_name, run_key)
);

create table public.rate_counters (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);

-- ------------------------------------------------------------------ RLS
alter table public.profiles enable row level security;            alter table public.profiles force row level security;
alter table public.businesses enable row level security;          alter table public.businesses force row level security;
alter table public.business_members enable row level security;    alter table public.business_members force row level security;
alter table public.slug_redirects enable row level security;      alter table public.slug_redirects force row level security;
alter table public.audit_log enable row level security;           alter table public.audit_log force row level security;
alter table public.domain_events enable row level security;       alter table public.domain_events force row level security;
alter table public.job_runs enable row level security;            alter table public.job_runs force row level security;
alter table public.rate_counters enable row level security;       alter table public.rate_counters force row level security;

-- Membership check against the table on every request (role is NOT cached in the JWT: removal is immediate).
create function private.is_member(p_business uuid, p_min_role text default 'staff') returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = p_business
      and m.user_id = (select auth.uid())
      and private.role_rank(m.role) >= private.role_rank(p_min_role)
  )
$$;
revoke all on function private.is_member(uuid, text) from public, anon;
grant execute on function private.is_member(uuid, text) to authenticated;
revoke all on function private.role_rank(text) from public, anon;
grant execute on function private.role_rank(text) to authenticated;

create policy profiles_select_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy businesses_select_member on public.businesses for select to authenticated using (private.is_member(id, 'staff'));
create policy businesses_update_admin on public.businesses for update to authenticated
  using (private.is_member(id, 'admin')) with check (private.is_member(id, 'admin'));

create policy members_select on public.business_members for select to authenticated
  using (user_id = (select auth.uid()) or private.is_member(business_id, 'admin'));

create policy redirects_select_admin on public.slug_redirects for select to authenticated using (private.is_member(business_id, 'admin'));
create policy audit_select_admin on public.audit_log for select to authenticated using (business_id is not null and private.is_member(business_id, 'admin'));

-- Explicit, minimal grants (default privileges are revoked, docs/05 §5.1).
grant select on public.profiles to authenticated;
grant update (display_name, phone) on public.profiles to authenticated;
grant select on public.businesses to authenticated;
grant update (name, phone, settings) on public.businesses to authenticated; -- slug, kind, published_at, created_by only via RPC
grant select on public.business_members, public.slug_redirects, public.audit_log to authenticated;
-- domain_events, job_runs, rate_counters: system only (no grants).

-- ------------------------------------------------------------------ private implementations
create function private.audit_write(p_business uuid, p_action text, p_entity text, p_entity_id text, p_meta jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (business_id, actor_id, action, entity, entity_id, meta)
  values (p_business, (select auth.uid()), p_action, p_entity, p_entity_id, coalesce(p_meta, '{}'::jsonb))
$$;
revoke all on function private.audit_write(uuid, text, text, text, jsonb) from public, anon, authenticated;

create function private.enqueue_event(p_business uuid, p_type text, p_payload jsonb default '{}', p_dedupe text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.domain_events (business_id, type, payload, dedupe_key)
  values (p_business, p_type, coalesce(p_payload, '{}'::jsonb), p_dedupe)
  on conflict (business_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.domain_events where business_id = p_business and dedupe_key = p_dedupe;
  end if;
  return v_id;
end $$;
revoke all on function private.enqueue_event(uuid, text, jsonb, text) from public, anon, authenticated;

-- Worker side (stage 6 wires a runner). FOR UPDATE SKIP LOCKED: concurrent workers never take the same event.
create function private.claim_events(p_limit int default 10)
returns setof public.domain_events language plpgsql security definer set search_path = '' as $$
begin
  return query
  with picked as (
    select e.id from public.domain_events e
    where e.processed_at is null and e.available_at <= now()
    order by e.created_at limit greatest(p_limit, 1)
    for update skip locked
  )
  update public.domain_events e
     set attempts = e.attempts + 1,
         available_at = now() + (least(power(2, e.attempts), 3600) * interval '1 second') -- exponential backoff until completed
  from picked where e.id = picked.id
  returning e.*;
end $$;
revoke all on function private.claim_events(int) from public, anon, authenticated;

create function private.complete_event(p_id uuid) returns void language sql security definer set search_path = '' as $$
  update public.domain_events set processed_at = now(), last_error = null where id = p_id
$$;
revoke all on function private.complete_event(uuid) from public, anon, authenticated;

create function private.fail_event(p_id uuid, p_error text) returns void language sql security definer set search_path = '' as $$
  update public.domain_events set last_error = left(p_error, 500) where id = p_id
$$;
revoke all on function private.fail_event(uuid, text) from public, anon, authenticated;

-- Job idempotency: true = this caller owns the run; false = already running/succeeded for this key.
create function private.begin_job(p_job text, p_key text) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.job_runs (job_name, run_key) values (p_job, p_key)
  on conflict (job_name, run_key) do update set status = 'running', started_at = now(), finished_at = null, error = null
    where public.job_runs.status = 'failed'
  returning id into v_id;
  return v_id is not null;
end $$;
revoke all on function private.begin_job(text, text) from public, anon, authenticated;

create function private.finish_job(p_job text, p_key text, p_error text default null) returns void language sql security definer set search_path = '' as $$
  update public.job_runs set status = case when p_error is null then 'succeeded' else 'failed' end, finished_at = now(), error = left(p_error, 500)
  where job_name = p_job and run_key = p_key
$$;
revoke all on function private.finish_job(text, text, text) from public, anon, authenticated;

-- Fixed-window counters in Postgres (decision D: Vercel Firewall + DB counters). now() is used so tests can freeze time per transaction.
create function private.rate_limit_hit(p_key text, p_window_seconds int, p_max int)
returns table (allowed boolean, retry_after int) language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into public.rate_counters (key, window_start, hits) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = public.rate_counters.hits + 1
  returning hits into v_hits;
  return query select v_hits <= p_max, greatest(1, ceil(p_window_seconds - extract(epoch from now() - v_start))::int);
end $$;
revoke all on function private.rate_limit_hit(text, int, int) from public, anon, authenticated;

create function private.rate_limit_gc() returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.rate_counters where window_start < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.rate_limit_gc() from public, anon, authenticated;

-- ---- business lifecycle
create function private.normalize_slug(p_slug text) returns text language sql immutable set search_path = '' as $$
  select lower(btrim(p_slug))
$$;

create function private.create_business_impl(p_name text, p_kind text, p_phone text, p_slug text, p_settings jsonb default '{}')
returns public.businesses language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_slug text := private.normalize_slug(p_slug);
  v_row public.businesses;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if (select count(*) from public.business_members where user_id = v_uid and role = 'owner') >= 3 then
    raise exception 'business_limit' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.slug_redirects where old_slug = v_slug) then
    raise exception 'slug_taken' using errcode = 'P0001';
  end if;
  -- Everything below is one transaction: either the whole business exists, or nothing does (ACC-01).
  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;
  insert into public.businesses (slug, name, kind, phone, settings, created_by)
  values (v_slug, btrim(p_name), p_kind, p_phone, coalesce(p_settings, '{}'::jsonb), v_uid)
  returning * into v_row;
  insert into public.business_members (business_id, user_id, role) values (v_row.id, v_uid, 'owner');
  perform private.audit_write(v_row.id, 'business.created', 'business', v_row.id::text, jsonb_build_object('kind', p_kind));
  perform private.enqueue_event(v_row.id, 'BusinessCreated', jsonb_build_object('slug', v_slug), 'created');
  return v_row;
exception when unique_violation then
  raise exception 'slug_taken' using errcode = 'P0001';
end $$;
revoke all on function private.create_business_impl(text, text, text, text, jsonb) from public, anon;
grant execute on function private.create_business_impl(text, text, text, text, jsonb) to authenticated;

create function private.change_slug_impl(p_business uuid, p_new_slug text) returns public.businesses
language plpgsql security definer set search_path = '' as $$
declare
  v_new text := private.normalize_slug(p_new_slug);
  v_old text;
  v_row public.businesses;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not private.is_member(p_business, 'owner') then raise exception 'forbidden' using errcode = '42501'; end if;
  select slug into v_old from public.businesses where id = p_business for update;
  if v_old = v_new then select * into v_row from public.businesses where id = p_business; return v_row; end if;
  if exists (select 1 from public.slug_redirects where old_slug = v_new and business_id <> p_business) then
    raise exception 'slug_taken' using errcode = 'P0001';
  end if;
  if (select count(*) from public.slug_redirects where business_id = p_business and old_slug <> v_new) >= 10 then
    raise exception 'redirect_limit' using errcode = 'P0001';
  end if;
  -- Redirects always point at the business (never at another slug) so chains and cycles cannot exist;
  -- taking back one of our own old slugs removes that redirect so it cannot shadow the live slug.
  delete from public.slug_redirects where old_slug = v_new and business_id = p_business;
  update public.businesses set slug = v_new where id = p_business returning * into v_row;
  insert into public.slug_redirects (old_slug, business_id) values (v_old, p_business) on conflict (old_slug) do nothing;
  perform private.audit_write(p_business, 'business.slug_changed', 'business', p_business::text, jsonb_build_object('from', v_old, 'to', v_new));
  return v_row;
exception when unique_violation then
  raise exception 'slug_taken' using errcode = 'P0001';
end $$;
revoke all on function private.change_slug_impl(uuid, text) from public, anon;
grant execute on function private.change_slug_impl(uuid, text) to authenticated;

-- Uniform answer for "is this slug usable": never says WHY it is unavailable (ACC-02 spirit), rate limited per user.
create function private.slug_available_impl(p_slug text) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_slug text := private.normalize_slug(p_slug);
  v_allowed boolean;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select r.allowed into v_allowed from private.rate_limit_hit('slug:' || v_uid::text, 60, 30) r;
  if not v_allowed then raise exception 'rate_limited' using errcode = 'P0001'; end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) not between 3 and 40 then return false; end if;
  if v_slug = any (array['admin','api','login','auth','book','app','www','dashboard','settings','design','static','onboarding','privacy','terms','support','help','billing','assets','public','_next']) then return false; end if;
  return not exists (select 1 from public.businesses where lower(slug) = v_slug)
     and not exists (select 1 from public.slug_redirects where old_slug = v_slug);
end $$;
revoke all on function private.slug_available_impl(text) from public, anon;
grant execute on function private.slug_available_impl(text) to authenticated;

-- Public booking pages resolve slugs through the system path only (service_role); anon/authenticated cannot call this.
create function private.resolve_slug(p_slug text)
returns table (business_id uuid, canonical_slug text, redirected boolean) language sql stable security definer set search_path = '' as $$
  select b.id, b.slug, false from public.businesses b where lower(b.slug) = private.normalize_slug(p_slug)
  union all
  select b.id, b.slug, true from public.slug_redirects r join public.businesses b on b.id = r.business_id
  where r.old_slug = private.normalize_slug(p_slug)
    and not exists (select 1 from public.businesses x where lower(x.slug) = private.normalize_slug(p_slug))
  limit 1
$$;
revoke all on function private.resolve_slug(text) from public, anon, authenticated;
grant execute on function private.resolve_slug(text) to service_role;
grant usage on schema private to service_role;

-- ACC-04: a business can be published (public booking link) only by an owner whose email is verified.
create function private.publish_business_impl(p_business uuid) returns public.businesses
language plpgsql security definer set search_path = '' as $$
declare v_row public.businesses;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not private.is_member(p_business, 'owner') then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is not null) then
    raise exception 'email_not_verified' using errcode = 'P0001';
  end if;
  update public.businesses set published_at = coalesce(published_at, now()) where id = p_business returning * into v_row;
  perform private.audit_write(p_business, 'business.published', 'business', p_business::text);
  return v_row;
end $$;
revoke all on function private.publish_business_impl(uuid) from public, anon;
grant execute on function private.publish_business_impl(uuid) to authenticated;

-- ------------------------------------------------------------------ public RPC wrappers (SECURITY INVOKER, thin)
create function public.create_business(p_name text, p_kind text, p_phone text, p_slug text, p_settings jsonb default '{}')
returns public.businesses language sql security invoker set search_path = '' as $$
  select * from private.create_business_impl(p_name, p_kind, p_phone, p_slug, p_settings)
$$;
create function public.change_business_slug(p_business uuid, p_new_slug text)
returns public.businesses language sql security invoker set search_path = '' as $$
  select * from private.change_slug_impl(p_business, p_new_slug)
$$;
create function public.slug_available(p_slug text) returns boolean language sql security invoker set search_path = '' as $$
  select private.slug_available_impl(p_slug)
$$;
create function public.publish_business(p_business uuid)
returns public.businesses language sql security invoker set search_path = '' as $$
  select * from private.publish_business_impl(p_business)
$$;
revoke all on function public.create_business(text, text, text, text, jsonb) from public, anon;
revoke all on function public.change_business_slug(uuid, text) from public, anon;
revoke all on function public.slug_available(text) from public, anon;
revoke all on function public.publish_business(uuid) from public, anon;
grant execute on function public.create_business(text, text, text, text, jsonb) to authenticated;
grant execute on function public.change_business_slug(uuid, text) to authenticated;
grant execute on function public.slug_available(text) to authenticated;
grant execute on function public.publish_business(uuid) to authenticated;
