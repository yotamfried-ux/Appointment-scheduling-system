-- Fix: define private.second_factor_satisfied() as an alias to private.second_factor_ok()
-- and ensure private.create_business_impl executes without function lookup errors.

create or replace function private.second_factor_satisfied() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.second_factor_ok();
$$;

revoke all on function private.second_factor_satisfied() from public, anon;
grant execute on function private.second_factor_satisfied() to authenticated;
