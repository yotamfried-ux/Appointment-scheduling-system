-- pgTAP: RSC-01/02 — a customer moves an appointment: one transaction, same row, same window as cancelling, atomic when the new slot is taken.
begin;
select * from no_plan();

delete from public.notification_log; delete from public.waitlist_offers; delete from public.waitlist_entries; delete from public.domain_events; delete from public.appointments;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000b1a1', 'authenticated', 'authenticated', 'r-owner@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000b1a2', 'authenticated', 'authenticated', 'r-staff@example.com', now(), '{}', '{}', now(), now());
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true); set local role service_role; end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'rs-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner creates a business');
select pg_temp.as_system();
update public.businesses set published_at = now() where slug = 'rs-alpha';
insert into public.business_members (business_id, user_id, role) select id, '00000000-0000-0000-0000-00000000b1a2', 'staff' from public.businesses where slug = 'rs-alpha';
create temp table ids as select (select id from public.businesses where slug = 'rs-alpha') as a, (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'rs-alpha') as s1;
grant select on ids to authenticated, service_role;


select pg_temp.as_service();
create temp table v as select (public.public_book((select a from ids), (select s1 from ids), now() + interval '3 days', 'דנה', '+972502220001', 'dana@example.com', 'business', '{}', 'rkey-0001', 'rh-1') ->> 'id')::uuid as appt;
create temp table o as select (public.public_book((select a from ids), (select s1 from ids), now() + interval '4 days', 'אחר', '+972502220002', 'other@example.com', 'business', '{}', 'rkey-0002', 'rh-2') ->> 'id')::uuid as appt;
grant select on v, o to service_role;
select pg_temp.as_system();
create temp table orig as select starts_at, reference from public.appointments where id = (select appt from v);
grant select on orig to service_role;
select pg_temp.as_service();

-- RSC-01: the same row moves; id and reference are kept; the count rises
select is((public.public_reschedule((select appt from v), now() + interval '5 days') ->> 'rescheduledCount')::int, 1, 'a move succeeds and is counted');
select pg_temp.as_system();
select is((select reference from public.appointments where id = (select appt from v)), (select reference from orig), 'the reference is unchanged (the private link stays valid)');
select isnt((select starts_at from public.appointments where id = (select appt from v)), (select starts_at from orig), 'the start moved');
select is((select count(*)::int from public.appointments where business_id = (select a from ids)), 2, 'no extra appointment was created');
select is((select ends_at - starts_at from public.appointments where id = (select appt from v)), interval '30 minutes', 'the booked duration is kept (RSC-03)');
select is((select count(*)::int from public.domain_events where type = 'AppointmentRescheduled'), 1, 'one domain event for the move');

-- atomic: a taken slot leaves the old one untouched
select pg_temp.as_service();
create temp table before as select starts_at as s, rescheduled_count as c from public.appointments where id = (select appt from v);
grant select on before to service_role;
select throws_ok($$ select public.public_reschedule((select appt from v), (select starts_at from public.appointments where id = (select appt from o))) $$, 'P0001', 'slot_taken', 'moving onto a taken slot is refused');
select pg_temp.as_system();
select is((select starts_at from public.appointments where id = (select appt from v)), (select s from before), 'ATOMIC: the old slot is still held after the refusal');
select is((select rescheduled_count from public.appointments where id = (select appt from v)), (select c from before), '...and nothing was counted');

-- policy checks
select pg_temp.as_service();
select throws_ok($$ select public.public_reschedule((select appt from v), (select starts_at from public.appointments where id = (select appt from v))) $$, 'P0001', 'same_slot', 'moving to the current slot is refused');
select throws_ok($$ select public.public_reschedule((select appt from v), now() + interval '10 minutes') $$, 'P0001', 'slot_in_past', 'inside the minimum notice is refused');
select throws_ok($$ select public.public_reschedule((select appt from v), now() + interval '400 days') $$, 'P0001', 'slot_too_far', 'beyond the horizon is refused');
select lives_ok($$ select public.public_reschedule((select appt from v), now() + interval '6 days') $$, 'second move');
select lives_ok($$ select public.public_reschedule((select appt from v), now() + interval '7 days') $$, 'third move');
select throws_ok($$ select public.public_reschedule((select appt from v), now() + interval '8 days') $$, 'P0001', 'reschedule_limit', 'a fourth move is refused (RSC limit)');

-- RSC-02: inside the cancellation window a move is not allowed either
select pg_temp.as_system();
create temp table soon as select (public.public_book((select a from ids), (select s1 from ids), now() + interval '2 hours', 'מאוחר', '+972502220003', null, 'business', '{}', 'rkey-0003', 'rh-3') ->> 'id')::uuid as appt;
grant select on soon to service_role;
select pg_temp.as_service();
select throws_ok($$ select public.public_reschedule((select appt from soon), now() + interval '3 days') $$, 'P0001', 'too_late', 'RSC-02: after the cancellation deadline the move is refused');

-- states
select pg_temp.as_system();
update public.appointments set status = 'cancelled_by_customer', cancelled_at = now() where id = (select appt from o);
select pg_temp.as_service();
select throws_ok($$ select public.public_reschedule((select appt from o), now() + interval '9 days') $$, 'P0001', 'invalid_transition', 'a cancelled appointment cannot be moved');

-- approval-required services go back to pending
select pg_temp.as_system();
update public.businesses set requires_approval = true where id = (select a from ids);
create temp table c1 as select (public.public_book((select a from ids), (select s1 from ids), now() + interval '12 days', 'מאושרת', '+972502220004', null, 'business', '{}', 'rkey-0004', 'rh-4') ->> 'id')::uuid as appt;
update public.appointments set status = 'confirmed' where id = (select appt from c1);
grant select on c1 to service_role;
select pg_temp.as_service();
select is(public.public_reschedule((select appt from c1), now() + interval '13 days') ->> 'status', 'pending', 'a confirmed appointment of an approval-required business is decided again after a move');

-- grants: nobody but the system can call it; the guard still protects the time columns for everyone else
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select throws_ok($$ select public.public_reschedule((select appt from v), now() + interval '9 days') $$, '42501', null, 'an authenticated user cannot call the reschedule function');
select pg_temp.as_system();
select throws_ok($$ update public.appointments set starts_at = starts_at + interval '1 hour' where id = (select appt from v) $$, 'P0001', 'appointment_immutable', 'direct time edits are still refused');
select is((select count(*)::int from private.lint_violations()), 0, 'schema lint stays empty');
select * from finish();
rollback;
