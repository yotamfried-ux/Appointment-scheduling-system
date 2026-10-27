-- Stage 25: Unlimited PRO for Whitelisted Users (Sivan & Platform Admin)
-- Sets active PRO with no expiration and full unlimited overrides for:
-- 1. suvankeinan@gmail.com (Sivan Keinan)
-- 2. yotam.fried@gmail.com (Platform Admin)
-- Strictly prevents non-whitelisted users from receiving unauthorized complimentary unlimited PRO.

create or replace function private.is_whitelisted_pro_email(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select lower(btrim(coalesce(p_email, ''))) in (
    'suvankeinan@gmail.com',
    'yotam.fried@gmail.com'
  );
$$;

revoke all on function private.is_whitelisted_pro_email(text) from public, anon;
grant execute on function private.is_whitelisted_pro_email(text) to authenticated, service_role;

-- Automatically grant unlimited PRO to businesses owned by whitelisted users on creation
create or replace function private.trg_auto_unlimited_pro_seed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_owner_email text;
  v_admin_id uuid;
begin
  select u.email into v_owner_email
  from auth.users u
  where u.id = new.user_id;

  if private.is_whitelisted_pro_email(v_owner_email) and new.role = 'owner' then
    select user_id into v_admin_id from public.platform_admins limit 1;
    if v_admin_id is null then
      v_admin_id := new.user_id;
    end if;

    update public.subscriptions
    set
      status = 'active',
      plan_id = 'pro',
      trial_ends_at = null,
      current_period_end = null,
      cancel_at_period_end = false,
      grace_until = null,
      provider = 'manual',
      updated_at = now()
    where business_id = new.business_id;

    insert into public.entitlement_overrides (business_id, key, bool_value, int_value, unlimited, reason, expires_at, created_by)
    values
      (new.business_id, 'max_services', null, null, true, 'חשבון PRO ללא הגבלה', null, v_admin_id),
      (new.business_id, 'waitlist', true, null, false, 'חשבון PRO ללא הגבלה', null, v_admin_id),
      (new.business_id, 'export', true, null, false, 'חשבון PRO ללא הגבלה', null, v_admin_id)
    on conflict (business_id, key) do update
    set bool_value = excluded.bool_value,
        int_value = excluded.int_value,
        unlimited = excluded.unlimited,
        reason = excluded.reason,
        expires_at = excluded.expires_at,
        created_at = now();
  end if;
  return new;
end $$;

revoke all on function private.trg_auto_unlimited_pro_seed() from public, anon;

drop trigger if exists trg_business_members_unlimited_pro on public.business_members;
create trigger trg_business_members_unlimited_pro
  after insert or update on public.business_members
  for each row execute function private.trg_auto_unlimited_pro_seed();

-- Apply immediately for existing businesses owned by whitelisted users
do $$
declare
  r record;
  v_admin_id uuid;
begin
  select user_id into v_admin_id from public.platform_admins limit 1;

  for r in
    select b.id as business_id, u.id as user_id, u.email
    from public.businesses b
    join public.business_members m on m.business_id = b.id and m.role = 'owner'
    join auth.users u on u.id = m.user_id
    where private.is_whitelisted_pro_email(u.email)
  loop
    update public.subscriptions
    set
      status = 'active',
      plan_id = 'pro',
      trial_ends_at = null,
      current_period_end = null,
      cancel_at_period_end = false,
      grace_until = null,
      provider = 'manual',
      updated_at = now()
    where business_id = r.business_id;

    insert into public.entitlement_overrides (business_id, key, bool_value, int_value, unlimited, reason, expires_at, created_by)
    values
      (r.business_id, 'max_services', null, null, true, 'חשבון PRO ללא הגבלה', null, coalesce(v_admin_id, r.user_id)),
      (r.business_id, 'waitlist', true, null, false, 'חשבון PRO ללא הגבלה', null, coalesce(v_admin_id, r.user_id)),
      (r.business_id, 'export', true, null, false, 'חשבון PRO ללא הגבלה', null, coalesce(v_admin_id, r.user_id))
    on conflict (business_id, key) do update
    set bool_value = excluded.bool_value,
        int_value = excluded.int_value,
        unlimited = excluded.unlimited,
        reason = excluded.reason,
        expires_at = excluded.expires_at,
        created_at = now();
  end loop;
end $$;
