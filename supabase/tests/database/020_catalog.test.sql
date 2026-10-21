-- pgTAP: catalog + availability (docs/04 CAT/AVL, SEC-01). Roles: owner / admin / staff / outsider / removed / anon / other tenant,
-- plus a NEGATIVE CONTROL (RLS off ⇒ the leak appears).
begin;
select * from no_plan();

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000001a1', 'authenticated', 'authenticated', 'c-owner-a@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000001a2', 'authenticated', 'authenticated', 'c-admin-a@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000001a3', 'authenticated', 'authenticated', 'c-staff-a@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000001b1', 'authenticated', 'authenticated', 'c-owner-b@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000001d1', 'authenticated', 'authenticated', 'c-outsider@example.com', now(), '{}', '{}', now(), now());

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------- ACC-01: the whole catalog is created with the business, atomically ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.create_business('מספרת קטלוג', 'barber', null, 'cat-alpha',
  '[{"name":"תספורת","durationMinutes":30,"priceNis":80},{"name":"צבע","durationMinutes":90,"priceNis":280}]',
  '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"12:00"},{"from":"13:00","to":"18:00"}]},{"weekday":1,"open":true,"windows":[{"from":"09:00","to":"18:00"}]},{"weekday":6,"open":false,"windows":[{"from":"09:00","to":"18:00"}]}]') $$,
  'owner A creates a business with services and weekly hours in one call');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001b1');
select lives_ok($$ select public.create_business('בטא קטלוג', 'clinic', null, 'cat-beta',
  '[{"name":"טיפול","durationMinutes":45,"priceNis":250}]', '[{"weekday":0,"open":true,"windows":[{"from":"08:00","to":"16:00"}]}]') $$, 'owner B creates business B');
select pg_temp.as_system();
insert into public.business_members (business_id, user_id, role)
select id, '00000000-0000-0000-0000-0000000001a2', 'admin' from public.businesses where slug = 'cat-alpha';
insert into public.business_members (business_id, user_id, role)
select id, '00000000-0000-0000-0000-0000000001a3', 'staff' from public.businesses where slug = 'cat-alpha';

create temp table ids as
  select (select id from public.businesses where slug = 'cat-alpha') as a, (select id from public.businesses where slug = 'cat-beta') as b,
         (select r.id from public.resources r join public.businesses x on x.id = r.business_id where x.slug = 'cat-alpha') as ra,
         (select r.id from public.resources r join public.businesses x on x.id = r.business_id where x.slug = 'cat-beta') as rb;
grant select on ids to authenticated, anon;

select is((select count(*)::int from public.resources where business_id = (select a from ids) and is_default), 1, 'ACC-01: exactly one default resource ("the business itself")');
select is((select count(*)::int from public.services where business_id = (select a from ids)), 2, 'ACC-01: both services were written');
select is((select price_cents from public.services where business_id = (select a from ids) and name = 'צבע'), 28000, 'price is stored in agorot (cents)');
select is((select count(*)::int from public.availability_rules where business_id = (select a from ids)), 3, 'ACC-01: open windows were written (split day = 2, plus Monday); closed days write nothing');
select is((select count(*)::int from public.availability_rules where business_id = (select a from ids) and weekday = 6), 0, 'a closed day has no rules');

-- failures leave NOTHING behind
select pg_temp.as_user('00000000-0000-0000-0000-0000000001d1');
select throws_ok($$ select public.create_business('עסק רע', 'barber', null, 'bad-hours', '[{"name":"שירות","durationMinutes":30,"priceNis":80}]',
  '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"12:00"},{"from":"11:00","to":"14:00"}]}]') $$, '23P01', null, 'AVL: overlapping weekly windows are rejected by the database');
select throws_ok($$ select public.create_business('עסק רע', 'barber', null, 'bad-svc', '[{"name":"שירות","durationMinutes":1,"priceNis":80}]', '[]') $$, '23514', null, 'CAT: a service shorter than 5 minutes is rejected');
select throws_ok($$ select public.create_business('עסק רע', 'barber', null, 'no-svc', '[]', '[]') $$, '23514', null, 'CAT: at least one service is required');
select throws_ok($$ select public.create_business('עסק רע', 'barber', null, 'bad-time', '[{"name":"שירות","durationMinutes":30,"priceNis":80}]',
  '[{"weekday":0,"open":true,"windows":[{"from":"18:00","to":"09:00"}]}]') $$, '23514', null, 'AVL: an inverted window is rejected');
select pg_temp.as_system();
select is((select count(*)::int from public.businesses where slug in ('bad-hours','bad-svc','no-svc','bad-time')), 0, 'rollback: no half-created business');
select is((select count(*)::int from public.resources where business_id not in (select id from public.businesses)), 0, 'rollback: no orphan resources');
select is((select count(*)::int from public.services s where not exists (select 1 from public.businesses b where b.id = s.business_id)), 0, 'rollback: no orphan services');

-- ---------- SEC-01: reads ----------
select pg_temp.as_anon();
select throws_ok($$ select * from public.services $$, '42501', null, 'anon cannot read services');
select throws_ok($$ select * from public.availability_rules $$, '42501', null, 'anon cannot read availability rules');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a3');
select is((select count(*)::int from public.services), 2, 'staff reads the services of their business');
select is((select count(*)::int from public.availability_rules), 3, 'staff reads the rules of their business');
select is((select count(*)::int from public.resources), 1, 'staff reads the resource');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001d1');
select is((select count(*)::int from public.services), 0, 'outsider sees no services');
select is((select count(*)::int from public.availability_rules), 0, 'outsider sees no rules');
select is((select count(*)::int from public.resources), 0, 'outsider sees no resources');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
select is((select count(*)::int from public.services where business_id = (select b from ids)), 0, 'SEC-01: owner A cannot see the services of B');
select is((select count(*)::int from public.availability_rules where business_id = (select b from ids)), 0, 'SEC-01: owner A cannot see the rules of B');
select pg_temp.as_system();

-- ---------- writes: roles ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a3');
select throws_ok($$ insert into public.services (business_id, name, duration_minutes, price_cents) values ((select a from ids), 'staff try', 30, 1000) $$, '42501', null, 'staff cannot create services');
update public.services set price_cents = 1 where business_id = (select a from ids);
delete from public.services where business_id = (select a from ids);
select throws_ok($$ insert into public.availability_rules (business_id, resource_id, weekday, start_minute, end_minute) values ((select a from ids), (select ra from ids), 3, 600, 700) $$, '42501', null, 'staff cannot create availability rules');
select pg_temp.as_system();
select is((select count(*)::int from public.services where business_id = (select a from ids) and price_cents = 1), 0, 'staff update changed 0 rows');
select is((select count(*)::int from public.services where business_id = (select a from ids)), 2, 'staff delete removed 0 rows');

select pg_temp.as_user('00000000-0000-0000-0000-0000000001d1');
select throws_ok($$ insert into public.services (business_id, name, duration_minutes, price_cents) values ((select a from ids), 'outsider try', 30, 1000) $$, '42501', null, 'outsider cannot create services for A');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
select throws_ok($$ insert into public.services (business_id, name, duration_minutes, price_cents) values ((select b from ids), 'cross tenant', 30, 1000) $$, '42501', null, 'SEC-01/02: owner A cannot create a service inside business B');
select throws_ok($$ insert into public.availability_rules (business_id, resource_id, weekday, start_minute, end_minute) values ((select b from ids), (select rb from ids), 3, 600, 700) $$, 'P0001', 'resource_mismatch', 'owner A cannot create rules inside business B (B''s resource is invisible to A, so the tenant check refuses first)');
select throws_ok($$ insert into public.availability_rules (business_id, resource_id, weekday, start_minute, end_minute) values ((select a from ids), (select rb from ids), 3, 600, 700) $$, 'P0001', 'resource_mismatch', 'a rule cannot point at another tenant''s resource');
update public.services set price_cents = 1 where business_id = (select b from ids);
select throws_ok($$ update public.services set business_id = (select b from ids) where business_id = (select a from ids) $$, '42501', null, 'business_id of a service is immutable from the client');
select throws_ok($$ update public.resources set is_default = false where business_id = (select a from ids) $$, '42501', null, 'resources.is_default is immutable from the client');
select throws_ok($$ insert into public.resources (business_id, name) values ((select a from ids), 'extra') $$, '42501', null, 'resources cannot be inserted directly (schema-ready only)');
select pg_temp.as_system();
select is((select count(*)::int from public.services where business_id = (select b from ids) and price_cents = 1), 0, 'cross-tenant update changed 0 rows');

-- ---------- CAT constraints (as admin) ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a2');
select lives_ok($$ insert into public.services (business_id, name, duration_minutes, price_cents, buffer_minutes, capacity) values ((select a from ids), 'זקן', 20, 4000, 5, 1) $$, 'admin creates a service');
select throws_ok($$ insert into public.services (business_id, name, duration_minutes, price_cents) values ((select a from ids), 'זקן', 20, 4000) $$, '23505', null, 'CAT: duplicate active name is rejected');
select throws_ok($$ insert into public.services (business_id, name, duration_minutes, price_cents) values ((select a from ids), 'קצר', 4, 4000) $$, '23514', null, 'CAT: duration < 5 rejected');
select throws_ok($$ insert into public.services (business_id, name, duration_minutes, price_cents) values ((select a from ids), 'ארוך', 481, 4000) $$, '23514', null, 'CAT: duration > 480 rejected');
select throws_ok($$ insert into public.services (business_id, name, duration_minutes, price_cents) values ((select a from ids), 'שלילי', 30, -1) $$, '23514', null, 'CAT: negative price rejected');
select throws_ok($$ insert into public.services (business_id, name, duration_minutes, price_cents, currency) values ((select a from ids), 'מטבע', 30, 100, 'shekel') $$, '23514', null, 'CAT: currency must be an ISO code');
select throws_ok($$ insert into public.services (business_id, name, duration_minutes, price_cents) values ((select a from ids), 'א', 30, 100) $$, '23514', null, 'CAT: one-letter name rejected');
update public.services set active = false where business_id = (select a from ids) and name = 'זקן';
select lives_ok($$ insert into public.services (business_id, name, duration_minutes, price_cents) values ((select a from ids), 'זקן', 25, 4500) $$, 'CAT: an archived name can be reused');
select pg_temp.as_system();

-- ---------- AVL constraints ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a2');
select throws_ok($$ insert into public.availability_rules (business_id, resource_id, weekday, start_minute, end_minute) values ((select a from ids), (select ra from ids), 0, 11 * 60, 14 * 60) $$, '23P01', null, 'AVL: a window overlapping an existing one is rejected');
select lives_ok($$ insert into public.availability_rules (business_id, resource_id, weekday, start_minute, end_minute) values ((select a from ids), (select ra from ids), 0, 12 * 60, 13 * 60) $$, 'AVL: touching windows are allowed (12:00–13:00 between 09–12 and 13–18)');
select throws_ok($$ insert into public.availability_rules (business_id, resource_id, weekday, start_minute, end_minute) values ((select a from ids), (select ra from ids), 2, 600, 600) $$, '23514', null, 'AVL: empty window rejected');
select throws_ok($$ insert into public.availability_rules (business_id, resource_id, weekday, start_minute, end_minute) values ((select a from ids), (select ra from ids), 7, 600, 700) $$, '23514', null, 'AVL: weekday 7 rejected');
select throws_ok($$ insert into public.availability_rules (business_id, resource_id, weekday, start_minute, end_minute) values ((select a from ids), (select ra from ids), 2, 600, 1441) $$, '23514', null, 'AVL: past midnight rejected');
select lives_ok($$ insert into public.availability_exceptions (business_id, resource_id, on_date, kind, note) values ((select a from ids), (select ra from ids), '2026-10-20', 'closed', 'חג') $$, 'AVL: full-day closure');
select lives_ok($$ insert into public.availability_exceptions (business_id, resource_id, on_date, kind, start_minute, end_minute) values ((select a from ids), (select ra from ids), '2026-10-21', 'closed', 600, 720) $$, 'AVL: partial closure');
select lives_ok($$ insert into public.availability_exceptions (business_id, resource_id, on_date, kind, start_minute, end_minute) values ((select a from ids), (select ra from ids), '2026-10-24', 'open', 600, 840) $$, 'AVL: special opening on a closed day');
select throws_ok($$ insert into public.availability_exceptions (business_id, resource_id, on_date, kind) values ((select a from ids), (select ra from ids), '2026-10-25', 'open') $$, '23514', null, 'AVL: a special opening needs hours');
select throws_ok($$ insert into public.availability_exceptions (business_id, resource_id, on_date, kind, start_minute) values ((select a from ids), (select ra from ids), '2026-10-25', 'closed', 600) $$, '23514', null, 'AVL: one-sided range rejected');
select throws_ok($$ insert into public.availability_exceptions (business_id, resource_id, on_date, kind, start_minute, end_minute) values ((select a from ids), (select ra from ids), '2026-10-25', 'closed', 700, 600) $$, '23514', null, 'AVL: inverted exception range rejected');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a3');
select throws_ok($$ insert into public.availability_exceptions (business_id, resource_id, on_date, kind) values ((select a from ids), (select ra from ids), '2026-10-30', 'closed') $$, '42501', null, 'staff cannot create exceptions');
select is((select count(*)::int from public.availability_exceptions), 3, 'staff can read exceptions');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001d1');
select is((select count(*)::int from public.availability_exceptions), 0, 'outsider cannot read exceptions');
select pg_temp.as_system();

-- ---------- replace_weekly_hours ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a3');
select throws_ok($$ select public.replace_weekly_hours((select a from ids), '[]') $$, '42501', null, 'staff cannot replace weekly hours');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001d1');
select throws_ok($$ select public.replace_weekly_hours((select a from ids), '[]') $$, '42501', null, 'outsider cannot replace weekly hours');
select pg_temp.as_anon();
select throws_ok($$ select public.replace_weekly_hours((select a from ids), '[]') $$, '42501', null, 'anon cannot call replace_weekly_hours');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a2');
select throws_ok($$ select public.replace_weekly_hours((select a from ids), '[{"weekday":2,"open":true,"windows":[{"from":"09:00","to":"12:00"},{"from":"11:00","to":"13:00"}]}]') $$, '23P01', null, 'overlap inside a replacement is rejected');
select pg_temp.as_system();
select is((select count(*)::int from public.availability_rules where business_id = (select a from ids)), 4, 'atomic: a failed replacement left the previous rules untouched');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a2');
select is((select public.replace_weekly_hours((select a from ids), '[{"weekday":2,"open":true,"windows":[{"from":"10:00","to":"14:00"}]},{"weekday":4,"open":true,"windows":[{"from":"08:00","to":"12:00"},{"from":"16:00","to":"20:00"}]}]')), 3, 'admin replaces the weekly hours (3 windows)');
select pg_temp.as_system();
select is((select count(*)::int from public.availability_rules where business_id = (select a from ids)), 3, 'old rules were replaced');
select is((select count(*)::int from public.audit_log where business_id = (select a from ids) and action = 'availability.replaced'), 1, 'the replacement is audited');
select is((select count(*)::int from public.availability_rules where business_id = (select b from ids)), 1, 'other tenant rules are untouched');

-- the audit writer must not be callable by clients (it would allow forging audit rows)
select ok(not has_function_privilege('authenticated', 'private.audit_write(uuid,text,text,text,jsonb)', 'EXECUTE'), 'authenticated cannot call private.audit_write');

-- removed member loses access with the same JWT
delete from public.business_members where user_id = '00000000-0000-0000-0000-0000000001a3';
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a3');
select is((select count(*)::int from public.services), 0, 'removed staff sees no services');
select pg_temp.as_system();

-- NEGATIVE CONTROL: RLS off ⇒ outsider sees services (so the tests above can fail)
alter table public.services disable row level security;
alter table public.services no force row level security;
select pg_temp.as_user('00000000-0000-0000-0000-0000000001d1');
select cmp_ok((select count(*)::int from public.services), '>', 0, 'negative control: RLS disabled ⇒ outsider sees services (leak detected)');
select pg_temp.as_system();
alter table public.services enable row level security;
alter table public.services force row level security;
select pg_temp.as_user('00000000-0000-0000-0000-0000000001d1');
select is((select count(*)::int from public.services), 0, 'negative control reverted');
select pg_temp.as_system();

select is_empty($$ select * from private.lint_violations() $$, 'schema lint is clean after the stage 3 migration');

select * from finish();
rollback;
