-- pgTAP: RSC-03/04 — changing the service while moving (only when the business allows it) and the owner moving a booking (customer told, may always decline).
begin;
select * from no_plan();

delete from public.notification_log; delete from public.waitlist_offers; delete from public.waitlist_entries; delete from public.domain_events; delete from public.appointments;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000b1a1', 'authenticated', 'authenticated', 'm-owner@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000b1a2', 'authenticated', 'authenticated', 'm-staff@example.com', now(), '{}', '{}', now(), now());
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true); set local role service_role; end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'mv-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80},{"name":"צבע","durationMinutes":60,"priceNis":200}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner creates a business');
select pg_temp.as_system();
update public.businesses set published_at = now() where slug = 'mv-alpha';
insert into public.business_members (business_id, user_id, role) select id, '00000000-0000-0000-0000-00000000b1a2', 'staff' from public.businesses where slug = 'mv-alpha';
create temp table ids as select (select id from public.businesses where slug = 'mv-alpha') as a, (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'mv-alpha' and s.name = 'תספורת') as s1;
grant select on ids to authenticated, service_role;


update public.businesses set min_notice_minutes = 0 where slug = 'mv-alpha';
create temp table svc as select (select id from public.services where business_id = (select a from ids) and name = 'תספורת') as cut, (select id from public.services where business_id = (select a from ids) and name = 'צבע') as color;
grant select on svc to service_role, authenticated;
select pg_temp.as_service();
create temp table v as select (public.public_book((select a from ids), (select cut from svc), now() + interval '3 days', 'דנה', '+972507770001', 'dana@example.com', 'business', '{}', 'mkey-0001', 'mh-1') ->> 'id')::uuid as appt;
create temp table w as select (public.public_book((select a from ids), (select cut from svc), now() + interval '2 hours', 'מאוחר', '+972507770002', 'u972507770002@example.com', 'business', '{}', 'mkey-0002', 'mh-2') ->> 'id')::uuid as appt;
grant select on v, w to service_role, authenticated;

-- ---- RSC-03
select throws_ok($$ select public.public_reschedule((select appt from v), now() + interval '4 days', (select color from svc)) $$, 'P0001', 'service_change_not_allowed', 'a different service is refused unless the business allows it');
select pg_temp.as_system();
update public.businesses set reschedule_service_change = true where slug = 'mv-alpha';
select pg_temp.as_service();
select lives_ok($$ select public.public_reschedule((select appt from v), now() + interval '4 days', (select color from svc)) $$, 'with the switch on the service can change while moving');
select pg_temp.as_system();
select is((select service_id from public.appointments where id = (select appt from v)), (select color from svc), 'the appointment is now the colouring');
select is((select ends_at - starts_at from public.appointments where id = (select appt from v)), interval '60 minutes', 'the length follows the new service');
select is((select price_cents from public.appointments where id = (select appt from v)), 20000, 'so does the price');
select is((select service_snapshot ->> 'name' from public.appointments where id = (select appt from v)), 'צבע', 'and the snapshot (what the customer sees in mail and on the private page)');
update public.services set active = false where id = (select cut from svc);
select pg_temp.as_service();
select throws_ok($$ select public.public_reschedule((select appt from v), now() + interval '5 days', (select cut from svc)) $$, 'P0001', 'service_unavailable', 'an archived service cannot be chosen');
select pg_temp.as_system();
update public.services set active = true where id = (select cut from svc);

-- ---- RSC-04: the owner moves a booking
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a2');
select throws_ok($$ select public.owner_move_appointment((select appt from v), now() + interval '6 days') $$, '42501', null, 'staff cannot move appointments');
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
create temp table before as select starts_at as s from public.appointments where id = (select appt from v);
grant select on before to authenticated;
select throws_ok($$ select public.owner_move_appointment((select appt from v), now() - interval '1 hour') $$, 'P0001', 'slot_in_past', 'moving into the past is refused');
select throws_ok($$ select public.owner_move_appointment((select appt from v), (select s from before)) $$, 'P0001', 'same_slot', 'moving to the same time is refused');
select throws_ok($$ select public.owner_move_appointment((select appt from v), (select starts_at from public.appointments where id = (select appt from w))) $$, 'P0001', 'slot_taken', 'moving onto a taken slot is refused');
select is((select starts_at from public.appointments where id = (select appt from v)), (select s from before), 'ATOMIC: the old time is still held after the refusal');
select lives_ok($$ select public.owner_move_appointment((select appt from v), now() + interval '6 days') $$, 'the owner moves it to a free time');
select pg_temp.as_system();
select is((select moved_by_business_at is not null from public.appointments where id = (select appt from v)), true, 'it is marked as moved by the business');
select is((select count(*)::int from public.domain_events where type = 'AppointmentMovedByBusiness'), 1, 'one event, so the customer is told');
select is((select count(*)::int from public.audit_log where business_id = (select a from ids) and action = 'appointment.moved'), 1, 'and the move is audited');
select is((select count(*)::int from public.appointments where business_id = (select a from ids)), 2, 'no appointment was duplicated');

-- the customer may always decline a time the business chose, even inside the cancellation window; a normal booking inside the window cannot be cancelled
select pg_temp.as_system();
update public.businesses set cancel_until_hours = 24 where slug = 'mv-alpha';
select pg_temp.as_service();
select throws_ok($$ select public.public_cancel((select appt from w)) $$, 'P0001', 'too_late', 'a normal booking inside the window cannot be cancelled by the customer');
select pg_temp.as_system();
update public.appointments set starts_at = starts_at where id = (select appt from v);
update public.businesses set cancel_until_hours = 24 * 30 where slug = 'mv-alpha';
select pg_temp.as_service();
select lives_ok($$ select public.public_cancel((select appt from v)) $$, 'the moved booking can be declined although 30 days of notice are required');
select pg_temp.as_system();
select is((select status from public.appointments where id = (select appt from v)), 'cancelled_by_customer', 'and it is cancelled');
select is((select count(*)::int from private.lint_violations()), 0, 'schema lint stays empty');
select * from finish();
rollback;
