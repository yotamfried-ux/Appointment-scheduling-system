-- Stage 9: SaaS subscriptions + entitlements. Provider-neutral core (BIL-11): nothing here names a payment provider.
-- The subscription state changes ONLY through private.billing_apply_event (called with the system key from the verified webhook) or a platform admin (BIL-09).

create table public.plans (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,30}$'),
  name text not null,
  price_cents int not null check (price_cents >= 0),          -- PLACEHOLDER pricing: editable data, decided by the owner of the product
  currency text not null default 'ILS',
  interval text not null default 'month' check (interval in ('month','year')),
  version int not null default 1,                              -- BIL-07: a price change creates a new version, old accounts keep theirs
  active boolean not null default true,
  position int not null default 0
);
create table public.plan_features (
  plan_id text not null references public.plans (id) on delete cascade,
  key text not null check (key in ('waitlist','export','max_services')),
  bool_value boolean,
  int_value int check (int_value is null or int_value >= 0),   -- both NULL on a limit key = unlimited
  primary key (plan_id, key)
);
insert into public.plans (id, name, price_cents, position) values ('starter', 'בסיס', 7900, 1), ('pro', 'מקצועי', 14900, 2);
insert into public.plan_features (plan_id, key, bool_value, int_value) values
  ('starter', 'waitlist', false, null), ('starter', 'export', false, null), ('starter', 'max_services', null, 5),
  ('pro', 'waitlist', true, null), ('pro', 'export', true, null), ('pro', 'max_services', null, null);

create table public.subscriptions (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  plan_id text not null references public.plans (id),
  plan_version int not null default 1,
  status text not null default 'trialing' check (status in ('trialing','active','past_due','canceled')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  grace_until timestamptz,
  provider text,                                               -- BIL-11: per-provider identifiers, never provider-shaped columns
  external_customer_id text,
  external_subscription_id text,
  last_event_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses (id) on delete cascade,
  provider text not null,
  event_id text not null,
  type text not null,
  occurred_at timestamptz not null,
  outcome text not null,
  received_at timestamptz not null default now(),
  unique (provider, event_id)                                  -- BIL-03: the same event twice changes nothing
);
create index billing_events_business_idx on public.billing_events (business_id, received_at desc);
create table public.entitlement_overrides (
  business_id uuid not null references public.businesses (id) on delete cascade,
  key text not null check (key in ('waitlist','export','max_services')),
  bool_value boolean,
  int_value int check (int_value is null or int_value >= 0),
  unlimited boolean not null default false,
  reason text not null check (char_length(btrim(reason)) between 5 and 300),
  expires_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (business_id, key)
);
create table public.platform_admins (user_id uuid primary key references auth.users (id) on delete cascade, created_at timestamptz not null default now());

alter table public.plans enable row level security;                 alter table public.plans force row level security;
alter table public.plan_features enable row level security;         alter table public.plan_features force row level security;
alter table public.subscriptions enable row level security;         alter table public.subscriptions force row level security;
alter table public.billing_events enable row level security;        alter table public.billing_events force row level security;
alter table public.entitlement_overrides enable row level security; alter table public.entitlement_overrides force row level security;
alter table public.platform_admins enable row level security;       alter table public.platform_admins force row level security;

create policy plans_select on public.plans for select to authenticated using (active);
create policy plan_features_select on public.plan_features for select to authenticated using (true);
create policy subscriptions_select on public.subscriptions for select to authenticated using (private.is_member(business_id, 'staff'));
create policy overrides_select on public.entitlement_overrides for select to authenticated using (private.is_member(business_id, 'staff'));
grant select on public.plans, public.plan_features to authenticated;
grant select (business_id, plan_id, plan_version, status, trial_ends_at, current_period_end, cancel_at_period_end, grace_until, provider, updated_at) on public.subscriptions to authenticated;   -- never the external ids
grant select (business_id, key, bool_value, int_value, unlimited, reason, expires_at, created_at) on public.entitlement_overrides to authenticated;
-- billing_events and platform_admins: no policies and no grants to API roles; only the definer functions below touch them.

-- ------------------------------------------------------------------ effective state (the ONE definition)
create function private.subscription_state(p_business uuid) returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select case
      when s.status = 'trialing' and s.trial_ends_at > now() then 'trial'
      when s.status = 'active' then 'active'
      when s.status = 'past_due' and s.grace_until > now() then 'grace'
      when s.status = 'canceled' and s.current_period_end > now() then 'active'      -- BIL-06: paid-for time is honoured
      else 'degraded' end
    from public.subscriptions s where s.business_id = p_business), 'degraded')
$$;

create function private.billing_accepts(p_business uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.subscription_state(p_business) in ('trial', 'active', 'grace')
$$;

create function private.entitlement_can(p_business uuid, p_key text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select o.bool_value from public.entitlement_overrides o where o.business_id = p_business and o.key = p_key and (o.expires_at is null or o.expires_at > now())),
    case when private.subscription_state(p_business) = 'degraded' then false
         else (select f.bool_value from public.subscriptions s join public.plan_features f on f.plan_id = s.plan_id and f.key = p_key where s.business_id = p_business) end,
    false)
$$;

-- NULL = unlimited. A missing plan row = 0 (closed by default).
create function private.entitlement_limit(p_business uuid, p_key text) returns int language sql stable security definer set search_path = '' as $$
  select case
    when o.business_id is not null then case when o.unlimited then null else o.int_value end
    when f.plan_id is not null then f.int_value
    else 0 end
  from (select 1) x
  left join public.entitlement_overrides o on o.business_id = p_business and o.key = p_key and (o.expires_at is null or o.expires_at > now())
  left join public.subscriptions s on s.business_id = p_business
  left join public.plan_features f on f.plan_id = s.plan_id and f.key = p_key
$$;
revoke all on function private.subscription_state(uuid), private.billing_accepts(uuid), private.entitlement_can(uuid, text), private.entitlement_limit(uuid, text) from public, anon;
grant execute on function private.subscription_state(uuid), private.billing_accepts(uuid), private.entitlement_can(uuid, text), private.entitlement_limit(uuid, text) to authenticated, service_role;

-- every business starts a 14-day trial of the full plan (BIL-01); existing businesses get the same from now
create function private.subscription_seed() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.subscriptions (business_id, plan_id, status, trial_ends_at) values (new.id, 'pro', 'trialing', now() + interval '14 days') on conflict do nothing;
  return new;
end $$;
create trigger businesses_subscription_seed after insert on public.businesses for each row execute function private.subscription_seed();
insert into public.subscriptions (business_id, plan_id, status, trial_ends_at) select id, 'pro', 'trialing', now() + interval '14 days' from public.businesses on conflict do nothing;

-- ------------------------------------------------------------------ enforcement in the database (BIL-01/05/08), not only in the UI
create function private.billing_guard_appointments() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not private.billing_accepts(new.business_id) then raise exception 'billing_inactive' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger appointments_billing_guard before insert on public.appointments for each row execute function private.billing_guard_appointments();

create function private.billing_guard_waitlist() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not private.entitlement_can(new.business_id, 'waitlist') then raise exception 'plan_required' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger waitlist_billing_guard before insert on public.waitlist_entries for each row execute function private.billing_guard_waitlist();

create function private.billing_guard_services() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit int;
begin
  if not new.active or (tg_op = 'UPDATE' and old.active) then return new; end if;     -- only adding/reactivating counts; being over quota never deletes anything (BIL-05)
  v_limit := private.entitlement_limit(new.business_id, 'max_services');
  if v_limit is not null and (select count(*) from public.services s where s.business_id = new.business_id and s.active and s.id is distinct from new.id) >= v_limit then
    raise exception 'plan_limit' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger services_billing_guard before insert or update of active on public.services for each row execute function private.billing_guard_services();

-- ------------------------------------------------------------------ what the owner sees
create function public.my_billing(p_business uuid) returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'state', private.subscription_state(s.business_id),
    'status', s.status, 'planId', s.plan_id, 'planName', p.name, 'priceCents', p.price_cents,
    'trialEndsAt', s.trial_ends_at, 'currentPeriodEnd', s.current_period_end, 'cancelAtPeriodEnd', s.cancel_at_period_end, 'graceUntil', s.grace_until,
    'provider', s.provider,
    'features', jsonb_build_object('waitlist', private.entitlement_can(s.business_id, 'waitlist'), 'export', private.entitlement_can(s.business_id, 'export')),
    'limits', jsonb_build_object('maxServices', private.entitlement_limit(s.business_id, 'max_services')),
    'usage', jsonb_build_object('services', (select count(*) from public.services x where x.business_id = s.business_id and x.active)),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object('key', o.key, 'reason', o.reason, 'expiresAt', o.expires_at))
                           from public.entitlement_overrides o where o.business_id = s.business_id and (o.expires_at is null or o.expires_at > now())), '[]'::jsonb))
  from public.subscriptions s join public.plans p on p.id = s.plan_id where s.business_id = p_business
$$;
revoke all on function public.my_billing(uuid) from public, anon;
grant execute on function public.my_billing(uuid) to authenticated;

-- ------------------------------------------------------------------ the only writer of subscription state (BIL-03/04)
create function private.billing_apply_event(p_provider text, p_event_id text, p_type text, p_occurred_at timestamptz, p_business uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.subscriptions; v_new_status text; v_plan text; v_inserted int; v_before text;
  v_outcome text := 'applied';
begin
  if p_provider is null or p_event_id is null or p_type not in ('subscription.updated', 'subscription.canceled', 'payment.failed', 'payment.succeeded') then
    raise exception 'invalid_event' using errcode = '23514';
  end if;
  insert into public.billing_events (business_id, provider, event_id, type, occurred_at, outcome)
  values ((select id from public.businesses where id = p_business), p_provider, p_event_id, p_type, p_occurred_at, 'pending')
  on conflict (provider, event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return jsonb_build_object('outcome', 'duplicate'); end if;

  select * into s from public.subscriptions where business_id = p_business for update;
  if not found then
    update public.billing_events set outcome = 'unknown_business' where provider = p_provider and event_id = p_event_id;
    return jsonb_build_object('outcome', 'unknown_business');
  end if;
  if s.last_event_at is not null and p_occurred_at < s.last_event_at then
    update public.billing_events set outcome = 'stale' where provider = p_provider and event_id = p_event_id;
    return jsonb_build_object('outcome', 'stale');                   -- an older fact never overrides a newer one
  end if;

  v_before := s.status;
  v_new_status := case p_type
    when 'payment.failed' then 'past_due'
    when 'payment.succeeded' then 'active'
    when 'subscription.canceled' then 'canceled'
    else coalesce(nullif(p_data->>'status', ''), s.status) end;
  if v_new_status not in ('trialing', 'active', 'past_due', 'canceled') then v_new_status := s.status; v_outcome := 'invalid_status'; end if;
  v_plan := nullif(p_data->>'planId', '');
  if v_plan is not null and not exists (select 1 from public.plans where id = v_plan and active) then v_plan := null; v_outcome := 'invalid_plan'; end if;

  update public.subscriptions set
    status = v_new_status,
    plan_id = coalesce(v_plan, plan_id),
    plan_version = case when v_plan is not null then (select version from public.plans where id = v_plan) else plan_version end,
    current_period_end = coalesce((p_data->>'currentPeriodEnd')::timestamptz, current_period_end),
    cancel_at_period_end = coalesce((p_data->>'cancelAtPeriodEnd')::boolean, case when v_new_status = 'canceled' then true else cancel_at_period_end end),
    trial_ends_at = coalesce((p_data->>'trialEnd')::timestamptz, trial_ends_at),
    grace_until = case when v_new_status = 'past_due' then coalesce(s.grace_until, p_occurred_at + interval '7 days')   -- BIL-02: the clock starts at the first failure
                       else null end,
    provider = p_provider,
    external_customer_id = coalesce(nullif(p_data->>'externalCustomerId', ''), external_customer_id),
    external_subscription_id = coalesce(nullif(p_data->>'externalSubscriptionId', ''), external_subscription_id),
    last_event_at = p_occurred_at,
    updated_at = now()
  where business_id = p_business;
  update public.billing_events set outcome = v_outcome where provider = p_provider and event_id = p_event_id;
  perform private.audit_write(p_business, 'billing.' || p_type, 'subscription', p_business::text, jsonb_build_object('from', v_before, 'to', v_new_status, 'plan', v_plan, 'provider', p_provider));
  return jsonb_build_object('outcome', v_outcome, 'status', v_new_status);
end $$;

-- identifiers a provider needs to find the business again (checkout/portal), system path only
create function private.billing_subscription_for(p_business uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('externalCustomerId', s.external_customer_id, 'externalSubscriptionId', s.external_subscription_id, 'provider', s.provider)
  from public.subscriptions s where s.business_id = p_business
$$;
create function public.billing_apply_event(p_provider text, p_event_id text, p_type text, p_occurred_at timestamptz, p_business uuid, p_data jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.billing_apply_event(p_provider, p_event_id, p_type, p_occurred_at, p_business, p_data) $$;
create function public.billing_subscription_for(p_business uuid) returns jsonb language sql stable security invoker set search_path = '' as $$ select private.billing_subscription_for(p_business) $$;
revoke all on function private.billing_apply_event(text, text, text, timestamptz, uuid, jsonb), private.billing_subscription_for(uuid), public.billing_apply_event(text, text, text, timestamptz, uuid, jsonb), public.billing_subscription_for(uuid) from public, anon, authenticated;
grant execute on function private.billing_apply_event(text, text, text, timestamptz, uuid, jsonb), private.billing_subscription_for(uuid), public.billing_apply_event(text, text, text, timestamptz, uuid, jsonb), public.billing_subscription_for(uuid) to service_role;
grant select on public.billing_events to service_role;

-- ------------------------------------------------------------------ platform admin: override + manual subscription (BIL-09, SEC-10). MFA (aal2) is required.
create function private.platform_admin_check() returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.platform_admins where user_id = (select auth.uid())) then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce((select auth.jwt()) ->> 'aal', '') <> 'aal2' then raise exception 'mfa_required' using errcode = '42501'; end if;
end $$;

create function private.admin_set_override_impl(p_business uuid, p_key text, p_bool boolean, p_int int, p_unlimited boolean, p_reason text, p_expires timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.platform_admin_check();
  if not exists (select 1 from public.businesses where id = p_business) then raise exception 'not_found' using errcode = 'P0001'; end if;
  if p_expires is not null and p_expires <= now() then raise exception 'expired' using errcode = '23514'; end if;
  insert into public.entitlement_overrides (business_id, key, bool_value, int_value, unlimited, reason, expires_at, created_by)
  values (p_business, p_key, p_bool, p_int, coalesce(p_unlimited, false), p_reason, p_expires, (select auth.uid()))
  on conflict (business_id, key) do update set bool_value = excluded.bool_value, int_value = excluded.int_value, unlimited = excluded.unlimited, reason = excluded.reason,
    expires_at = excluded.expires_at, created_by = excluded.created_by, created_at = now();
  perform private.audit_write(p_business, 'billing.override_set', 'entitlement', p_key, jsonb_build_object('reason', p_reason, 'expiresAt', p_expires));    -- visible to the business owner (SEC-10)
end $$;

create function private.admin_remove_override_impl(p_business uuid, p_key text) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.platform_admin_check();
  delete from public.entitlement_overrides where business_id = p_business and key = p_key;
  perform private.audit_write(p_business, 'billing.override_removed', 'entitlement', p_key, '{}'::jsonb);
end $$;

-- the `manual` provider: no payment provider is connected, a platform admin records what was agreed/paid outside the system
create function private.admin_manual_subscription_impl(p_business uuid, p_plan text, p_status text, p_period_end timestamptz, p_reason text) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.platform_admin_check();
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'reason_required' using errcode = '23514'; end if;
  -- an admin's decision is the latest fact by definition: it is ordered after whatever the last event was
  return private.billing_apply_event('manual', gen_random_uuid()::text, 'subscription.updated',
    greatest(clock_timestamp(), coalesce((select last_event_at from public.subscriptions where business_id = p_business), '-infinity'::timestamptz) + interval '1 millisecond'), p_business,
    jsonb_build_object('planId', p_plan, 'status', p_status, 'currentPeriodEnd', p_period_end));
end $$;

create function public.admin_set_override(p_business uuid, p_key text, p_bool boolean, p_int int, p_unlimited boolean, p_reason text, p_expires timestamptz) returns void language sql security invoker set search_path = '' as $$ select private.admin_set_override_impl(p_business, p_key, p_bool, p_int, p_unlimited, p_reason, p_expires) $$;
create function public.admin_remove_override(p_business uuid, p_key text) returns void language sql security invoker set search_path = '' as $$ select private.admin_remove_override_impl(p_business, p_key) $$;
create function public.admin_manual_subscription(p_business uuid, p_plan text, p_status text, p_period_end timestamptz, p_reason text) returns jsonb language sql security invoker set search_path = '' as $$ select private.admin_manual_subscription_impl(p_business, p_plan, p_status, p_period_end, p_reason) $$;
revoke all on function private.platform_admin_check(), private.admin_set_override_impl(uuid, text, boolean, int, boolean, text, timestamptz), private.admin_remove_override_impl(uuid, text), private.admin_manual_subscription_impl(uuid, text, text, timestamptz, text),
  public.admin_set_override(uuid, text, boolean, int, boolean, text, timestamptz), public.admin_remove_override(uuid, text), public.admin_manual_subscription(uuid, text, text, timestamptz, text) from public, anon;
grant execute on function private.platform_admin_check(), private.admin_set_override_impl(uuid, text, boolean, int, boolean, text, timestamptz), private.admin_remove_override_impl(uuid, text), private.admin_manual_subscription_impl(uuid, text, text, timestamptz, text),
  public.admin_set_override(uuid, text, boolean, int, boolean, text, timestamptz), public.admin_remove_override(uuid, text), public.admin_manual_subscription(uuid, text, text, timestamptz, text) to authenticated;

-- ------------------------------------------------------------------ existing functions that must now honour entitlements (bodies unchanged except for the marked lines)
create or replace function private.waitlist_offer_for_slot(p_business uuid, p_starts_at timestamptz, p_freed_until timestamptz, p_force_entry uuid default null, p_ignore_auto boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses; e public.waitlist_entries; s public.services;
  v_offer uuid; v_exp timestamptz; v_local timestamp; v_min int;
begin
  select * into b from public.businesses where id = p_business and published_at is not null;
  if not found or not b.waitlist_enabled or not private.entitlement_can(p_business, 'waitlist') then return null; end if;                -- BIL-08: no offers without the feature
  if not p_ignore_auto and not b.waitlist_auto_offer then return null; end if;                      -- WLT-06
  if p_starts_at < now() + make_interval(mins => b.min_notice_minutes) then return null; end if;
  if exists (select 1 from public.appointments a where a.business_id = p_business and a.status in ('pending','confirmed','cancellation_requested')
             and tstzrange(a.starts_at, a.blocked_until, '[)') && tstzrange(p_starts_at, p_freed_until, '[)')) then return null; end if;   -- the hole must really be free
  v_local := p_starts_at at time zone b.timezone;
  v_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  select w.* into e from public.waitlist_entries w join public.services sv on sv.id = w.service_id
   where w.business_id = p_business and w.status = 'waiting' and w.on_date = v_local::date and (p_force_entry is null or w.id = p_force_entry)
     and sv.active and sv.capacity = 1
     and sv.duration_minutes + sv.buffer_minutes <= extract(epoch from (p_freed_until - p_starts_at)) / 60
     and (w.from_minute is null or (v_min >= w.from_minute and v_min + sv.duration_minutes <= w.to_minute))
     and not exists (select 1 from public.waitlist_offers o where o.entry_id = w.id and o.slot_starts_at = p_starts_at)
   order by w.created_at, w.id                                                                         -- WLT-01: first come, first served
   limit 1 for update of w skip locked;
  if not found then return null; end if;
  select * into s from public.services where id = e.service_id;
  v_exp := least(now() + make_interval(mins => b.waitlist_offer_minutes), p_starts_at - interval '10 minutes');
  if v_exp <= now() + interval '1 minute' then return null; end if;
  begin
    insert into public.waitlist_offers (business_id, entry_id, slot_starts_at, slot_ends_at, blocked_until, freed_until, expires_at)
    values (p_business, e.id, p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes), p_starts_at + make_interval(mins => s.duration_minutes + s.buffer_minutes), p_freed_until, v_exp)
    returning id into v_offer;
  exception when exclusion_violation then return null;                                                 -- another live offer already holds this time
  end;
  update public.waitlist_entries set status = 'offered' where id = e.id;
  perform private.notif_enqueue_offer(v_offer, 'waitlist_offer');
  return v_offer;
end $$;

create or replace function private.public_catalog(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
      'requiresApproval', b.requires_approval, 'cancelUntilHours', b.cancel_until_hours, 'minNoticeMinutes', b.min_notice_minutes, 'horizonDays', b.booking_horizon_days, 'waitlistEnabled', b.waitlist_enabled and private.entitlement_can(b.id, 'waitlist'),
      'acceptingBookings', private.billing_accepts(b.id)),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', coalesce(s.description, ''), 'durationMinutes', s.duration_minutes,
        'bufferMinutes', s.buffer_minutes, 'priceCents', s.price_cents, 'requiresApproval', s.requires_approval) order by s.position, s.created_at)
        from public.services s where s.business_id = b.id and s.active and s.capacity = 1), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('weekday', r.weekday, 'startMinute', r.start_minute, 'endMinute', r.end_minute))
        from public.availability_rules r where r.business_id = b.id and r.resource_id = v_res), '[]'::jsonb),
    'exceptions', coalesce((select jsonb_agg(jsonb_build_object('date', e.on_date, 'kind', e.kind, 'startMinute', e.start_minute, 'endMinute', e.end_minute))
        from public.availability_exceptions e where e.business_id = b.id and e.resource_id = v_res and e.on_date >= (current_date - 2)), '[]'::jsonb)
  );
end $$;
