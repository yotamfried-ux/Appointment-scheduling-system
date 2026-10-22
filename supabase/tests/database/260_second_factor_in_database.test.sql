-- pgTAP: an account with a verified second factor sees and changes nothing through the database with a password-only session (aal1); an account without one is unaffected.
begin;
select * from no_plan();

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000f6a1', 'authenticated', 'authenticated', 'mf-with@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000f6b1', 'authenticated', 'authenticated', 'mf-without@example.com', now(), '{}', '{}', now(), now());
create function pg_temp.as_user(p_uid uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true); set local role authenticated; end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000f6a1');
select lives_ok($$ select public.create_business('מספרה עם אימות', 'barber', null, 'mf-with', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[]') $$, 'owner WITH a second factor creates a business (before enrolling)');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f6b1');
select lives_ok($$ select public.create_business('מספרה בלי אימות', 'barber', null, 'mf-without', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[]') $$, 'owner WITHOUT one creates a business');
select pg_temp.as_system();
create temp table ids as select (select id from public.businesses where slug = 'mf-with') as w, (select id from public.businesses where slug = 'mf-without') as wo;
grant select on ids to authenticated;

-- the first account turns on a verified second factor
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values ('00000000-0000-0000-0000-00000000f6f1', '00000000-0000-0000-0000-00000000f6a1', 'phone', 'totp', 'verified', now(), now());

select pg_temp.as_user('00000000-0000-0000-0000-00000000f6a1', 'aal1');
select is((select count(*)::int from public.businesses where id = (select w from ids)), 0, 'password-only session: the business is not visible');
select is((select count(*)::int from public.services where business_id = (select w from ids)), 0, '...nor its services');
select throws_ok($$ select public.owner_export_account((select w from ids)) $$, '42501', null, '...the account export is refused');
select throws_ok($$ select public.request_business_deletion((select w from ids), 'מספרה עם אימות') $$, '42501', null, '...a deletion request is refused');

select pg_temp.as_user('00000000-0000-0000-0000-00000000f6a1', 'aal2');
select is((select count(*)::int from public.businesses where id = (select w from ids)), 1, 'session that passed the second factor (aal2): the business is visible');
select lives_ok($$ select public.owner_export_account((select w from ids)) $$, '...and the export works');

-- an unverified factor (abandoned enrolment) changes nothing
select pg_temp.as_system();
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values ('00000000-0000-0000-0000-00000000f6f2', '00000000-0000-0000-0000-00000000f6b1', 'half-done', 'totp', 'unverified', now(), now());
select pg_temp.as_user('00000000-0000-0000-0000-00000000f6b1', 'aal1');
select is((select count(*)::int from public.businesses where id = (select wo from ids)), 1, 'an account with only an unverified factor is not held back');
select lives_ok($$ select public.owner_export_account((select wo from ids)) $$, '...and an account with no factor works as before');

select * from finish();
rollback;
