-- pgTAP: ACC-09 — export and deletion with a grace period: owner only, future appointments cancelled with events, cancel restores, purge removes everything.
begin;
select * from no_plan();

delete from public.notification_log; delete from public.waitlist_offers; delete from public.waitlist_entries; delete from public.domain_events; delete from public.appointments;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000b1a1', 'authenticated', 'authenticated', 'd-owner@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000b1a2', 'authenticated', 'authenticated', 'd-staff@example.com', now(), '{}', '{}', now(), now());
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true); set local role service_role; end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'dl-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner creates a business');
select pg_temp.as_system();
update public.businesses set published_at = now() where slug = 'dl-alpha';
insert into public.business_members (business_id, user_id, role) select id, '00000000-0000-0000-0000-00000000b1a2', 'staff' from public.businesses where slug = 'dl-alpha';
create temp table ids as select (select id from public.businesses where slug = 'dl-alpha') as a, (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'dl-alpha') as s1;
grant select on ids to authenticated, service_role;


select pg_temp.as_service();
create temp table v as select (public.public_book((select a from ids), (select s1 from ids), now() + interval '3 days', 'דנה', '+972505550001', 'dana@example.com', 'business', '{}', 'dkey-0001', 'dh-1') ->> 'id')::uuid as appt;
create temp table w as select (public.public_book((select a from ids), (select s1 from ids), now() + interval '4 days', 'גיל', '+972505550002', 'gil@example.com', 'business', '{}', 'dkey-0002', 'dh-2') ->> 'id')::uuid as appt;
grant select on v, w to service_role;
select public.waitlist_join((select a from ids), (select s1 from ids), (now() at time zone 'Asia/Jerusalem')::date + 6, null, null, 'ממתין', '+972505550003', 'wait@example.com', 'dh-w');
select pg_temp.as_system();

-- ---- export: owner only, complete, audited
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a2');
select throws_ok($$ select public.owner_export_account((select a from ids)) $$, '42501', null, 'staff cannot export the account');
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
create temp table ex as select public.owner_export_account((select a from ids)) as j;
select pg_temp.as_system();
grant select on ex to authenticated;
select is(jsonb_array_length((select j from ex) -> 'appointments'), 2, 'the export holds the appointments');
select is(jsonb_array_length((select j from ex) -> 'customers'), 3, 'the export holds the customers (two bookers and the waitlisted one)');
select is((select j from ex) -> 'customers' -> 0 ->> 'phone' is not null, true, 'customer details are in the export (the owner''s own data)');
select ok(not ((select j from ex)::text like '%deletion_requested_at%'), 'internal lifecycle columns are not exported');
select is((select count(*)::int from public.audit_log where business_id = (select a from ids) and action = 'account.export'), 1, 'the export is audited');
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select throws_ok($$ select public.owner_export_account('00000000-0000-0000-0000-0000000000ff') $$, '42501', null, 'another business cannot be exported');

-- ---- deletion request
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a2');
select throws_ok($$ select public.request_business_deletion((select a from ids), (select name from public.businesses where id = (select a from ids))) $$, '42501', null, 'staff cannot request deletion');
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select throws_ok($$ select public.request_business_deletion((select a from ids), 'שם לא נכון') $$, 'P0001', 'confirmation_mismatch', 'the business name has to be typed correctly');
select is((select count(*)::int from public.appointments where business_id = (select a from ids) and status = 'confirmed'), 2, 'nothing changed after the refused attempt');
select is(public.request_business_deletion((select a from ids), (select name from public.businesses where slug = 'dl-alpha')) ->> 'appointmentsCancelled', '2', 'the request cancels both future appointments');
select pg_temp.as_system();
select is((select count(*)::int from public.appointments where business_id = (select a from ids) and status = 'cancelled_by_business'), 2, 'they are cancelled by the business');
select is((select count(*)::int from public.domain_events where business_id = (select a from ids) and type = 'AppointmentStatusChanged' and payload ->> 'action' = 'cancel'), 2, 'each cancellation queues the normal customer message');
select is((select status from public.waitlist_entries where business_id = (select a from ids)), 'cancelled', 'the waitlist is closed');
select is((select published_at is null and deletion_scheduled_for > now() + interval '13 days' from public.businesses where slug = 'dl-alpha'), true, 'the booking page is closed and a 14-day grace period is set');
select pg_temp.as_service();
select throws_ok($$ select public.public_book((select a from ids), (select s1 from ids), now() + interval '8 days', 'חדש', '+972505550009', null, 'business', '{}', 'dkey-0009', 'dh-9') $$, 'P0001', 'not_found', 'nobody can book while deletion is pending');
select pg_temp.as_system();
select throws_ok($$ update public.businesses set published_at = now() where slug = 'dl-alpha' $$, 'P0001', 'deletion_pending', 'no path can re-publish it while deletion is pending');
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select is(public.request_business_deletion((select a from ids), 'x') ->> 'outcome', 'already', 'a second request is a no-op');

-- ---- cancel the request: published again, appointments stay cancelled
select lives_ok($$ select public.cancel_business_deletion((select a from ids)) $$, 'the owner cancels the deletion');
select pg_temp.as_system();
select is((select published_at is not null and deletion_scheduled_for is null from public.businesses where slug = 'dl-alpha'), true, 'the page is back and the schedule is gone');
select is((select count(*)::int from public.appointments where business_id = (select a from ids) and status = 'cancelled_by_business'), 2, 'the cancelled appointments stay cancelled (the customers were told)');

-- ---- purge only after the grace period
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select public.request_business_deletion((select a from ids), (select name from public.businesses where slug = 'dl-alpha'));
select pg_temp.as_service();
select is(public.purge_deleted_businesses(now() + interval '10 days'), 0, 'before the grace period ends nothing is purged');
select pg_temp.as_system();
select is((select count(*)::int from public.businesses where slug = 'dl-alpha'), 1, '...the business is still there');
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select throws_ok($$ select public.purge_deleted_businesses(now() + interval '20 days') $$, '42501', null, 'an owner cannot run the purge');
select pg_temp.as_service();
select is(public.purge_deleted_businesses(now() + interval '15 days'), 1, 'after the grace period it is purged');
select pg_temp.as_system();
select is((select count(*)::int from public.businesses where slug = 'dl-alpha'), 0, 'the business is gone');
select is((select count(*)::int from public.customers where business_id = (select a from ids)) + (select count(*)::int from public.appointments where business_id = (select a from ids)) + (select count(*)::int from public.services where business_id = (select a from ids)), 0, 'and with it customers, appointments and services');
select is((select count(*)::int from public.audit_log where business_id = (select a from ids) and action = 'account.purged'), 1, 'the audit trail records the purge (and holds no personal data)');
select is((select count(*)::int from private.lint_violations()), 0, 'schema lint stays empty');
select * from finish();
rollback;
