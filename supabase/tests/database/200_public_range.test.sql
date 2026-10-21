-- pgTAP: public_range does in one call what the rate limiter, the catalog and the busy times did in three — and nothing else.
begin;
select * from no_plan();

delete from public.rate_counters; delete from public.waitlist_offers; delete from public.waitlist_entries; delete from public.domain_events; delete from public.appointments;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000d1a1', 'authenticated', 'authenticated', 'rng-owner@example.com', now(), '{}', '{}', now(), now());
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true); set local role service_role; end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000d1a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'rng-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner creates a business');
select pg_temp.as_system();
update public.businesses set published_at = now() where slug = 'rng-alpha';
create temp table ids as select (select id from public.businesses where slug = 'rng-alpha') as a, (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'rng-alpha') as s1;
grant select on ids to authenticated, service_role;

select pg_temp.as_service();
select public.public_book((select a from ids), (select s1 from ids), now() + interval '2 days', 'דנה', '+972505570001', 'd@example.com', 'business', '{}', 'gkey-0001', 'gh-1');
select public.public_book((select a from ids), (select s1 from ids), now() + interval '3 days', 'גיל', '+972505570002', 'g@example.com', 'business', '{}', 'gkey-0002', 'gh-2');
create temp table r as select public.public_range('rng-alpha', (now() at time zone 'Asia/Jerusalem')::date, 28, 'read:test-1', 60, 100) as j;
grant select on r to service_role;
create temp table sep as select * from public.public_busy((select a from ids), (now() at time zone 'Asia/Jerusalem')::date::timestamp at time zone 'Asia/Jerusalem' - interval '24 hours', ((now() at time zone 'Asia/Jerusalem')::date + 28)::timestamp at time zone 'Asia/Jerusalem' + interval '24 hours');
grant select on sep to service_role;

select is((select j -> 'catalog' = public.public_catalog('rng-alpha') from r), true, 'the catalog is the same as the separate call');
select is((select jsonb_array_length(j -> 'busy') from r), (select count(*)::int from sep), 'the busy list has as many rows as the separate call');
select is((select count(*)::int from sep), 2, 'and it holds the two bookings');
select is((select (j -> 'rate' ->> 'allowed')::boolean from r), true, 'the first request is allowed');

-- the counter counts, and a refused request reads nothing else
select public.public_range('rng-alpha', current_date, 1, 'read:test-2', 60, 1);
create temp table refused as select public.public_range('rng-alpha', current_date, 1, 'read:test-2', 60, 1) as j;
grant select on refused to service_role;
select is((select (j -> 'rate' ->> 'allowed')::boolean from refused), false, 'over the limit: refused');
select is((select j ? 'catalog' from refused), false, 'a refused request returns no business data');

-- unknown and unpublished look the same
select is((select public.public_range('no-such-business', current_date, 1, 'read:test-3', 60, 100) -> 'catalog'), 'null'::jsonb, 'an unknown business has no catalog');
select pg_temp.as_system();
update public.businesses set published_at = null where slug = 'rng-alpha';
select pg_temp.as_service();
select is((select public.public_range('rng-alpha', current_date, 1, 'read:test-4', 60, 100) -> 'catalog'), 'null'::jsonb, 'an unpublished business looks the same');

select pg_temp.as_user('00000000-0000-0000-0000-00000000d1a1');
select throws_ok($$ select public.public_range('rng-alpha', current_date, 1, 'read:test-5', 60, 100) $$, '42501', null, 'an owner session cannot call the system function');
select pg_temp.as_system();

select * from finish();
rollback;
