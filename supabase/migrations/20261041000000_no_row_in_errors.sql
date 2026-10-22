-- Strix VULN-0009 (2026-10-21): when a CHECK or NOT NULL constraint rejects a value, Postgres puts the whole row into the error DETAIL
-- ("Failing row contains (...)") and the Data API returns it to the caller. The caller only ever sees their own row, but it is schema and
-- stored values in an unexpected place, and it names the constraint. These five public wrappers reach tables with such constraints
-- without validating first (create_business, its services, the weekly hours, the slug change, the manual appointment), so each now
-- catches the violation and answers with one short, stable error: SQLSTATE 23514 (the application already maps it to a validation error),
-- message "invalid_input", no detail. All other errors (forbidden, slug_taken, business_limit, ...) pass through unchanged.

create or replace function public.create_business(p_name text, p_kind text, p_phone text, p_slug text, p_services jsonb, p_hours jsonb) returns public.businesses
language plpgsql security invoker set search_path = '' as $$
begin
  return private.create_business_impl(p_name, p_kind, p_phone, p_slug, p_services, p_hours);
exception when check_violation or not_null_violation then
  raise exception 'invalid_input' using errcode = '23514';
end $$;

create or replace function public.change_business_slug(p_business uuid, p_new_slug text) returns public.businesses
language plpgsql security invoker set search_path = '' as $$
begin
  return private.change_slug_impl(p_business, p_new_slug);
exception when check_violation or not_null_violation then
  raise exception 'invalid_input' using errcode = '23514';
end $$;

create or replace function public.replace_weekly_hours(p_business uuid, p_hours jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
begin
  return private.replace_weekly_hours_impl(p_business, p_hours);
exception when check_violation or not_null_violation then
  raise exception 'invalid_input' using errcode = '23514';
end $$;

create or replace function public.set_staff_hours(p_resource uuid, p_hours jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
begin
  return private.set_staff_hours_impl(p_resource, p_hours);
exception when check_violation or not_null_violation then
  raise exception 'invalid_input' using errcode = '23514';
end $$;

create or replace function public.create_manual_appointment_team(p_business uuid, p_service uuid, p_starts_at timestamptz, p_full_name text, p_phone text, p_note text, p_out_of_availability boolean, p_resource uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  return private.create_manual_appointment_team(p_business, p_service, p_starts_at, p_full_name, p_phone, p_note, p_out_of_availability, p_resource);
exception when check_violation or not_null_violation then
  raise exception 'invalid_input' using errcode = '23514';
end $$;
