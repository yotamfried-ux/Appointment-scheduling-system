-- Strix (2026-10-21/22): the second factor was enforced by the application only. An account that turned on a second factor could still be read and
-- changed through the Data API (the public key plus a password-only session): customers, appointments, the account export, a deletion request.
-- Every membership check in the database now also asks "does this account have a verified second factor, and did THIS session pass it?" (aal2 in the
-- signed token). An account without a verified factor behaves exactly as before. All read policies and all owner functions go through
-- private.is_member / private.my_business_ids, so these two are the only places that change.

create function private.second_factor_ok() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified')
$$;
revoke all on function private.second_factor_ok() from public, anon;
grant execute on function private.second_factor_ok() to authenticated;

create or replace function private.is_member(p_business uuid, p_min_role text default 'staff') returns boolean
language sql stable security definer set search_path = '' as $$
  select (select private.second_factor_ok()) and exists (
    select 1 from public.business_members m
    where m.business_id = p_business
      and m.user_id = (select auth.uid())
      and private.role_rank(m.role) >= private.role_rank(p_min_role)
  )
$$;

create or replace function private.my_business_ids(p_min_role text default 'staff') returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.business_id from public.business_members m
  where m.user_id = (select auth.uid()) and private.role_rank(m.role) >= private.role_rank(p_min_role)
    and (select private.second_factor_ok())
$$;
