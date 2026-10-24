-- pgTAP: the customer's acceptance of the terms and the privacy policy is stored with the booking and the waitlist entry (owner decision 2026-10-24).
begin;
select * from no_plan();

delete from public.notification_log; delete from public.waitlist_offers; delete from public.waitlist_entries; delete from public.domain_events; delete from public.appointments;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000f1a1', 'authenticated', 'authenticated', 't-owner@example.com', now(), '{}', '{}', now(), now());
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true); set local role service_role; end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000f1a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'ta-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner creates a business');
select pg_temp.as_system();
update public.businesses set published_at = now() where slug = 'ta-alpha';
create temp table ids as select (select id from public.businesses where slug = 'ta-alpha') as a, (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'ta-alpha') as s1;
grant select on ids to authenticated, service_role;

-- ---------- booking: versions + time are stored
select pg_temp.as_service();
create temp table b1 as select public.public_book_team((select a from ids), (select s1 from ids), now() + interval '3 days', 'דנה לוי', '+972501110001', 'dana@example.com', 'business', '{}', 'ta-key-0001', 'th-1', null, false, '2026-10-21', '2026-10-20') as r;
create temp table b2 as select public.public_book((select a from ids), (select s1 from ids), now() + interval '4 days', 'דנה לוי', '+972501110001', 'dana@example.com', 'business', '{}', 'ta-key-0002', 'th-2') as r;
grant select on b1, b2 to service_role;
select pg_temp.as_system();
select is((select terms_version || '|' || privacy_version from public.appointments where id = ((select r from b1) ->> 'id')::uuid), '2026-10-21|2026-10-20', 'the appointment stores the versions it was accepted under');
select ok((select terms_accepted_at between now() - interval '1 minute' and now() + interval '1 minute' from public.appointments where id = ((select r from b1) ->> 'id')::uuid), '...and the time');
select ok((select terms_version is null and privacy_version is null and terms_accepted_at is null from public.appointments where id = ((select r from b2) ->> 'id')::uuid), 'a call without versions (old callers) stores no acceptance');

-- a replay returns the first appointment and does not rewrite it
select pg_temp.as_service();
select is((select public.public_book_team((select a from ids), (select s1 from ids), now() + interval '3 days', 'דנה לוי', '+972501110001', 'dana@example.com', 'business', '{}', 'ta-key-0001', 'th-1', null, false, '2099-01-01', '2099-01-01') ->> 'replay'), 'true', 'a replay is recognised');
select pg_temp.as_system();
select is((select terms_version from public.appointments where id = ((select r from b1) ->> 'id')::uuid), '2026-10-21', 'the replay did not change the recorded version');

-- ---------- owner's manual appointment: no acceptance needed
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1a1');
select lives_ok($$ select public.create_manual_appointment((select a from ids), (select s1 from ids), now() + interval '40 days', 'לקוח טלפוני', '+972501112223', null, true) $$, 'the owner enters a walk-in without any acceptance');
select pg_temp.as_system();
select is((select count(*)::int from public.appointments where business_id = (select a from ids) and terms_version is null), 2, 'the walk-in and the old-style call carry no acceptance');

-- ---------- waitlist
select pg_temp.as_service();
create temp table w1 as select public.waitlist_join((select a from ids), (select s1 from ids), (now() at time zone 'Asia/Jerusalem')::date + 2, null, null, 'ממתינה', '+972501110003', 'wait@example.com', 'idem-w-1', '2026-10-21', '2026-10-21') as r;
select pg_temp.as_system();
select is((select terms_version || '|' || privacy_version from public.waitlist_entries where id = ((select r from w1) ->> 'id')::uuid), '2026-10-21|2026-10-21', 'the waitlist entry stores the versions');
select ok((select terms_accepted_at is not null from public.waitlist_entries where id = ((select r from w1) ->> 'id')::uuid), '...and the time');

-- ---------- the new columns are not writable by the browser roles
select ok(not has_table_privilege('anon', 'public.appointments', 'update') and not has_column_privilege('authenticated', 'public.appointments', 'terms_version', 'update'), 'no browser role can rewrite the recorded acceptance');
select ok(not has_column_privilege('authenticated', 'public.waitlist_entries', 'terms_version', 'update'), '...nor on the waitlist');

select is((select count(*)::int from private.lint_violations()), 0, 'the schema lint is clean');
select * from finish();
rollback;
