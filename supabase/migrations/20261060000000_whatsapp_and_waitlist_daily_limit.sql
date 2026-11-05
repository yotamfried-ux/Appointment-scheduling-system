-- Stage 29: WhatsApp Business Messaging Capability (opt-in, disabled by default) & Waitlist Daily Limit (uniform across working days).
--
-- 1. Businesses columns:
--    - waitlist_daily_limit: optional integer (1..500) limiting active ('waiting', 'offered') waitlist entries per day across all working days. NULL = unlimited.
--    - whatsapp_enabled: boolean NOT NULL DEFAULT false (explicitly opt-in; never enabled by default; ready for subscription plan gating).
-- 2. Plan features & entitlement overrides:
--    - Extend allowed feature keys to include 'whatsapp', seeded as false for both 'starter' and 'pro' plans so it is not enabled by default.
-- 3. private.waitlist_join_impl:
--    - Enforce businesses.waitlist_daily_limit per business and date (on_date) with transaction-scoped advisory lock, raising 'waitlist_day_full' (P0001) when full.
-- 4. private.notif_context:
--    - Include business.whatsappEnabled and customer.phone so the notification dispatcher can deliver WhatsApp messages when enabled.

alter table public.businesses
  add column if not exists waitlist_daily_limit int
    check (waitlist_daily_limit is null or (waitlist_daily_limit between 1 and 500)),
  add column if not exists whatsapp_enabled boolean not null default false;

grant update (waitlist_daily_limit, whatsapp_enabled) on public.businesses to authenticated;

alter table public.plan_features
  drop constraint if exists plan_features_key_check;

alter table public.plan_features
  add constraint plan_features_key_check
  check (key in ('waitlist', 'export', 'max_services', 'whatsapp'));

alter table public.entitlement_overrides
  drop constraint if exists entitlement_overrides_key_check;

alter table public.entitlement_overrides
  add constraint entitlement_overrides_key_check
  check (key in ('waitlist', 'export', 'max_services', 'whatsapp'));

insert into public.plan_features (plan_id, key, bool_value, int_value)
values
  ('starter', 'whatsapp', false, null),
  ('pro', 'whatsapp', false, null)
on conflict (plan_id, key) do nothing;

create or replace function private.waitlist_join_impl(
  p_business uuid,
  p_service uuid,
  p_date date,
  p_from int,
  p_to int,
  p_full_name text,
  p_phone text,
  p_email text,
  p_idem_hash text default null,
  p_terms_version text default null,
  p_privacy_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.businesses;
  s public.services;
  v_cust uuid;
  v_entry public.waitlist_entries;
  v_existing public.waitlist_entries;
begin
  select * into b from public.businesses where id = p_business and published_at is not null;
  if not found or not b.waitlist_enabled then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  select * into s from public.services where id = p_service and business_id = p_business and active and capacity = 1;
  if not found then
    raise exception 'service_unavailable' using errcode = 'P0001';
  end if;

  if nullif(btrim(coalesce(p_email, '')), '') is null then
    raise exception 'email_required' using errcode = '23514';
  end if;

  if p_date < (now() at time zone b.timezone)::date or p_date > (now() at time zone b.timezone)::date + b.booking_horizon_days then
    raise exception 'date_out_of_range' using errcode = 'P0001';
  end if;

  insert into public.customers (business_id, full_name, phone, email, email_key)
  values (p_business, btrim(p_full_name), p_phone, btrim(p_email), private.mailbox_key(p_email))
  on conflict (business_id, email_key) where email_key is not null do update set full_name = public.customers.full_name
  returning id into v_cust;

  select * into v_existing
  from public.waitlist_entries
  where business_id = p_business
    and customer_id = v_cust
    and service_id = p_service
    and on_date = p_date
    and status in ('waiting', 'offered');

  if found then
    return jsonb_build_object(
      'replay', true,
      'id', v_existing.id,
      'status', v_existing.status,
      'owner', p_idem_hash is not null and v_existing.idem_hash = p_idem_hash
    );
  end if;

  if (
    select count(*)
    from public.waitlist_entries
    where business_id = p_business
      and customer_id = v_cust
      and status in ('waiting', 'offered')
  ) >= 3 then
    raise exception 'waitlist_limit' using errcode = 'P0001';
  end if;

  if b.waitlist_daily_limit is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('wl_day_limit:' || p_business::text || ':' || p_date::text));
    if (
      select count(*)
      from public.waitlist_entries
      where business_id = p_business
        and on_date = p_date
        and status in ('waiting', 'offered')
    ) >= b.waitlist_daily_limit then
      raise exception 'waitlist_day_full' using errcode = 'P0001';
    end if;
  end if;

  insert into public.waitlist_entries (
    business_id,
    service_id,
    customer_id,
    contact_email,
    idem_hash,
    terms_version,
    privacy_version,
    terms_accepted_at,
    on_date,
    from_minute,
    to_minute
  )
  values (
    p_business,
    p_service,
    v_cust,
    btrim(p_email),
    p_idem_hash,
    p_terms_version,
    p_privacy_version,
    case when p_terms_version is not null then now() end,
    p_date,
    p_from,
    p_to
  )
  returning * into v_entry;

  return jsonb_build_object('replay', false, 'owner', true, 'id', v_entry.id, 'status', v_entry.status);
end $$;

revoke all on function
  private.waitlist_join_impl(uuid, uuid, date, int, int, text, text, text, text, text, text),
  public.waitlist_join(uuid, uuid, date, int, int, text, text, text, text, text, text)
from public, anon, authenticated;

grant execute on function
  private.waitlist_join_impl(uuid, uuid, date, int, int, text, text, text, text, text, text),
  public.waitlist_join(uuid, uuid, date, int, int, text, text, text, text, text, text)
to service_role;

create or replace function private.notif_context(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', n.id, 'type', n.type, 'recipient', n.recipient, 'attempts', n.attempts,
    'appointment', case when a.id is null then null else jsonb_build_object('id', a.id, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at, 'reference', a.reference,
                                      'serviceName', a.service_snapshot->>'name', 'location', a.location,
                                      'personName', (select r.name from public.resources r where r.id = a.resource_id and (select count(*) from public.resources x where x.business_id = b.id and x.active) >= 2)) end,
    'offer', case when o.id is null then null else jsonb_build_object('id', o.id, 'status', o.status, 'slotStartsAt', o.slot_starts_at, 'expiresAt', o.expires_at,
                                      'serviceName', sv.name, 'entryId', o.entry_id,
                                      'personName', (select r.name from public.resources r where r.id = o.resource_id and (select count(*) from public.resources x where x.business_id = b.id and x.active) >= 2)) end,
    'digest', case when n.type <> 'owner_digest' or n.digest_date is null then null else jsonb_build_object('date', n.digest_date,
        'cancelledYesterday', (select count(*) from public.appointments x where x.business_id = b.id and x.status like 'cancelled%' and (x.cancelled_at at time zone b.timezone)::date = n.digest_date - 1),
        'unmarked', (select count(*) from public.appointments x where x.business_id = b.id and x.status = 'confirmed' and x.ends_at < now()),
        'tomorrow', (select count(*) from public.appointments x where x.business_id = b.id and x.status in ('pending','confirmed') and (x.starts_at at time zone b.timezone)::date = n.digest_date + 1)) end,
    'billing', case when n.type not in ('owner_trial_ending','owner_trial_last_day','owner_payment_failed') then null
                    else (select jsonb_build_object('status', sub.status, 'trialEndsAt', sub.trial_ends_at, 'graceUntil', sub.grace_until) from public.subscriptions sub where sub.business_id = b.id) end,
    'registration', case when n.type <> 'admin_business_registered' then null
                         else jsonb_build_object('businessId', b.id, 'name', b.name, 'slug', b.slug, 'createdAt', b.created_at, 'publishedAt', b.published_at, 'kind', b.kind) end,
    'business', jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'kind', b.kind, 'timezone', b.timezone, 'phone', b.phone, 'whatsappEnabled', b.whatsapp_enabled),
    'customer', jsonb_build_object('name', c.full_name, 'email', coalesce(a.contact_email, e.contact_email), 'phone', c.phone),
    'owner', jsonb_build_object('email', (select u.email from public.business_members m join auth.users u on u.id = m.user_id
                                          where m.business_id = b.id and m.role = 'owner' order by m.created_at limit 1))
  )
  from public.notification_log n
  join public.businesses b on b.id = n.business_id
  left join public.appointments a on a.id = n.appointment_id
  left join public.waitlist_offers o on o.id = n.offer_id
  left join public.waitlist_entries e on e.id = o.entry_id
  left join public.services sv on sv.id = e.service_id
  left join public.customers c on c.id = coalesce(a.customer_id, e.customer_id)
  where n.id = p_id
$$;
