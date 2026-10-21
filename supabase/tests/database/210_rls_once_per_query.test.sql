-- pgTAP: the read policies look the membership up once per statement (no per-row is_member call), and who sees what has not changed:
-- a member sees their own business only, a staff member sees it too but not admin-level data, an outsider and a signed-out caller see nothing.
begin;
select * from no_plan();

delete from public.rate_counters; delete from public.notification_log; delete from public.waitlist_offers; delete from public.waitlist_entries; delete from public.domain_events; delete from public.appointments;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000e1a1', 'authenticated', 'authenticated', 'rls-a@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000e1a2', 'authenticated', 'authenticated', 'rls-b@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000e1a3', 'authenticated', 'authenticated', 'rls-staff@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000e1a4', 'authenticated', 'authenticated', 'rls-outsider@example.com', now(), '{}', '{}', now(), now());
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true); set local role service_role; end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

-- the shape: these read policies no longer call is_member per row
select is((select count(*)::int from pg_policies where schemaname = 'public' and cmd = 'SELECT' and qual like '%is_member(%'), 0, 'no read policy calls is_member per row any more');
select is((select count(*)::int from pg_policies where schemaname = 'public' and policyname in ('appointments_select', 'customers_select', 'notification_select', 'waitlist_entries_select', 'services_select', 'businesses_select_member', 'audit_select_admin') and qual like '%my_business_ids%'), 7, 'the hot read policies use the once-per-statement lookup');
select ok(not has_function_privilege('anon', 'private.my_business_ids(text)', 'EXECUTE'), 'anon cannot call the lookup');

-- two businesses with a booking each
select pg_temp.as_user('00000000-0000-0000-0000-00000000e1a1');
select lives_ok($$ select public.create_business('מספרה א', 'barber', null, 'rls-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner A creates a business');
select pg_temp.as_user('00000000-0000-0000-0000-00000000e1a2');
select lives_ok($$ select public.create_business('מספרה ב', 'barber', null, 'rls-beta', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner B creates a business');
select pg_temp.as_system();
update public.businesses set published_at = now() where slug in ('rls-alpha', 'rls-beta');
insert into public.business_members (business_id, user_id, role) select id, '00000000-0000-0000-0000-00000000e1a3', 'staff' from public.businesses where slug = 'rls-alpha';
create temp table ids as select (select id from public.businesses where slug = 'rls-alpha') as a, (select id from public.businesses where slug = 'rls-beta') as b,
  (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'rls-alpha') as sa, (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'rls-beta') as sb;
grant select on ids to authenticated, service_role;
select pg_temp.as_service();
select public.public_book((select a from ids), (select sa from ids), now() + interval '2 days', 'דנה', '+972505580001', 'd@example.com', 'business', '{}', 'ekey-0001', 'eh-1');
select public.public_book((select b from ids), (select sb from ids), now() + interval '2 days', 'גיל', '+972505580002', 'g@example.com', 'business', '{}', 'ekey-0002', 'eh-2');
select pg_temp.as_system();

-- owner A
select pg_temp.as_user('00000000-0000-0000-0000-00000000e1a1');
select is((select count(*)::int from public.appointments), 1, 'owner A sees exactly their own appointment');
select is((select count(*)::int from public.appointments where business_id = (select b from ids)), 0, 'and none of business B');
select is((select count(*)::int from public.customers), 1, 'owner A sees only their own customer');
select is((select count(*)::int from public.businesses), 1, 'owner A sees only their own business');
select is((select count(*)::int from public.business_members), 2, 'owner A sees the members of their own business (themselves and the staff member)');
-- staff member of A
select pg_temp.as_user('00000000-0000-0000-0000-00000000e1a3');
select is((select count(*)::int from public.appointments), 1, 'the staff member sees the business''s appointment');
select is((select count(*)::int from public.customers where business_id = (select b from ids)), 0, 'but nothing of business B');
select is((select count(*)::int from public.business_members), 1, 'a staff member sees only their own membership row (member lists are admin-level)');
select is((select count(*)::int from public.audit_log), 0, 'and no audit log (admin-level)');
-- an outsider and a signed-out caller
select pg_temp.as_user('00000000-0000-0000-0000-00000000e1a4');
select is((select count(*)::int from public.appointments) + (select count(*)::int from public.customers) + (select count(*)::int from public.businesses) + (select count(*)::int from public.services), 0, 'a signed-in non-member sees nothing');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select count(*) from public.appointments $$, '42501', null, 'a signed-out caller has no access at all');
select pg_temp.as_system();

select * from finish();
rollback;
