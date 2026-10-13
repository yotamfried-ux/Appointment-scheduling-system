-- pgTAP: stage 16 — several people per business (TEAM-01..10, 13). Each guarantee has a negative control (the refused case right next to the allowed one).
begin;
select * from no_plan();

delete from public.notification_log; delete from public.waitlist_offers; delete from public.waitlist_entries; delete from public.domain_events; delete from public.appointments;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000c1a1', 'authenticated', 'authenticated', 't-owner@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000c1a2', 'authenticated', 'authenticated', 't-staff@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000c1b1', 'authenticated', 'authenticated', 't-other@example.com', now(), '{}', '{}', now(), now());
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); set local role anon; end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true); set local role service_role; end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'tm-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80},{"name":"צבע","durationMinutes":60,"priceNis":200}]',
  '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]},{"weekday":1,"open":true,"windows":[{"from":"09:00","to":"18:00"}]},{"weekday":2,"open":true,"windows":[{"from":"09:00","to":"18:00"}]},{"weekday":3,"open":true,"windows":[{"from":"09:00","to":"18:00"}]},{"weekday":4,"open":true,"windows":[{"from":"09:00","to":"18:00"}]},{"weekday":5,"open":true,"windows":[{"from":"09:00","to":"14:00"}]},{"weekday":6,"open":true,"windows":[{"from":"09:00","to":"14:00"}]}]') $$, 'owner A creates a business');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1b1');
select lives_ok($$ select public.create_business('מספרה ב', 'barber', null, 'tm-beta', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner B creates a business');
select pg_temp.as_system();
update public.businesses set published_at = now(), min_notice_minutes = 0 where slug in ('tm-alpha', 'tm-beta');
insert into public.business_members (business_id, user_id, role) select id, '00000000-0000-0000-0000-00000000c1a2', 'staff' from public.businesses where slug = 'tm-alpha';

create temp table ids as select
  (select id from public.businesses where slug = 'tm-alpha') as a,
  (select id from public.businesses where slug = 'tm-beta') as b,
  (select r.id from public.resources r join public.businesses x on x.id = r.business_id where x.slug = 'tm-alpha' and r.is_default) as p0,
  (select r.id from public.resources r join public.businesses x on x.id = r.business_id where x.slug = 'tm-beta' and r.is_default) as pb,
  (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'tm-alpha' and s.name = 'תספורת') as cut,
  (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'tm-alpha' and s.name = 'צבע') as color,
  (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'tm-beta') as sb,
  date_trunc('day', now()) + interval '10 days' as day;
update public.services set buffer_minutes = 0;
grant select on ids to authenticated, anon, service_role;

-- ================================================================ TEAM-01: add / rename / deactivate
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a2');
select throws_ok($$ select public.create_staff((select a from ids), 'נועם') $$, '42501', null, 'staff (not admin) cannot add a person');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1b1');
select throws_ok($$ select public.create_staff((select a from ids), 'נועם') $$, '42501', null, 'another business owner cannot add a person here');
select pg_temp.as_anon();
select throws_ok($$ select public.create_staff((select a from ids), 'נועם') $$, '42501', null, 'anon cannot add a person');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a1');
select lives_ok($$ select public.create_staff((select a from ids), 'נועם') $$, 'the owner adds a person');
select lives_ok($$ select public.create_staff((select a from ids), 'דנה') $$, 'and another');
select pg_temp.as_system();
create temp table team as select
  (select id from public.resources where business_id = (select a from ids) and name = 'נועם') as noam,
  (select id from public.resources where business_id = (select a from ids) and name = 'דנה') as dana;
grant select on team to authenticated, service_role;
select is((select position from public.resources where id = (select noam from team)), 1, 'positions follow creation order (default person is 0)');
select is((select position from public.resources where id = (select dana from team)), 2, 'second added is 2');
select is((select kind from public.resources where id = (select noam from team)), 'staff', 'an added person is kind staff');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a1');
select throws_ok($$ select public.create_staff((select a from ids), '  נועם ') $$, 'P0001', 'name_taken', 'two active people cannot share a name');
select throws_ok($$ select public.create_staff((select a from ids), '   ') $$, '23514', null, 'an empty name is refused');
select throws_ok($$ select public.create_staff((select a from ids), repeat('x', 81)) $$, '23514', null, 'a name longer than 80 is refused');
select is((select (public.update_staff((select noam from team), 'נועם ב') ->> 'name')), 'נועם ב', 'rename works');
select lives_ok($$ select public.update_staff((select noam from team), 'נועם') $$, 'rename back');
select is((select count(*)::int from public.audit_log where business_id = (select a from ids) and action in ('staff.created', 'staff.updated')), 4, 'two creations and two updates are audited');

-- 30 people at most (negative control: the 30th works, the 31st is refused)
select pg_temp.as_system();
insert into public.resources (business_id, name, kind, position) select (select a from ids), 'p' || g, 'staff', 10 + g from generate_series(1, 27) g;
select is((select count(*)::int from public.resources where business_id = (select a from ids)), 30, 'thirty people exist');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a1');
select throws_ok($$ select public.create_staff((select a from ids), 'שלושים ואחד') $$, 'P0001', 'team_limit', 'the 31st person is refused');
select pg_temp.as_system();
delete from public.resources where business_id = (select a from ids) and name like 'p%' and name ~ '^p[0-9]+$';
select is((select count(*)::int from public.resources where business_id = (select a from ids)), 3, 'back to three people');

-- the last active person cannot be switched off; deactivating needs another active one
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1b1');
select throws_ok($$ select public.update_staff((select pb from ids), null, false) $$, 'P0001', 'last_active_person', 'the only person of a business cannot be deactivated');
select throws_ok($$ select public.update_staff((select noam from team), 'x', null) $$, '42501', null, 'cannot edit another business'' person');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a1');
update public.resources set active = false where business_id = (select b from ids);
select pg_temp.as_system();
select is((select active from public.resources where id = (select pb from ids)), true, 'RLS: a raw update by another owner changed nothing');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a1');

-- ================================================================ TEAM-02: hours and closures
select lives_ok($$ select public.set_staff_hours((select noam from team), '[{"weekday":0,"open":true,"windows":[{"from":"10:00","to":"16:00"}]}]') $$, 'hours of one person');
select lives_ok($$ select public.set_staff_hours((select dana from team), '[{"weekday":0,"open":true,"windows":[{"from":"12:00","to":"20:00"}]}]') $$, 'hours of another');
select pg_temp.as_system();
select is((select count(*)::int from public.availability_rules where resource_id = (select p0 from ids)), 7, 'the default person''s hours were not touched');
select is((select start_minute::int from public.availability_rules where resource_id = (select noam from team)), 600, 'Noam starts at 10:00');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1b1');
select throws_ok($$ select public.set_staff_hours((select noam from team), '[]') $$, '42501', null, 'another business cannot set a person''s hours');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a1');
select throws_ok($$ select public.set_staff_hours((select noam from team), '{"a":1}') $$, '23514', null, 'malformed hours are refused');
select lives_ok($$ select public.replace_weekly_hours((select a from ids), '[{"weekday":1,"open":true,"windows":[{"from":"08:00","to":"12:00"}]}]') $$, 'the single-person call still sets the default person''s hours');
select pg_temp.as_system();
select is((select count(*)::int from public.availability_rules where resource_id = (select noam from team)), 1, 'and it did not touch the others');
-- business-wide closure: an exception without a person
insert into public.availability_exceptions (business_id, resource_id, on_date, kind) values ((select a from ids), null, current_date + 20, 'closed');
select pg_temp.as_service();
select is((select jsonb_array_length(public.public_catalog('tm-alpha') -> 'exceptions')), 1, 'the closure is in the public catalog');
select is((public.public_catalog('tm-alpha') -> 'exceptions' -> 0 -> 'resourceId'), 'null'::jsonb, 'and it names nobody (applies to everybody)');
select pg_temp.as_system();
select throws_ok($$ insert into public.availability_exceptions (business_id, resource_id, on_date, kind) values ((select a from ids), (select pb from ids), current_date + 21, 'closed') $$, 'P0001', 'resource_mismatch', 'a person of another business is refused in an exception');
select throws_ok($$ insert into public.availability_rules (business_id, resource_id, weekday, start_minute, end_minute) values ((select a from ids), null, 1, 1, 2) $$, '23502', null, 'a weekly rule still needs a person');

-- ================================================================ TEAM-03: service restriction (no rows = everybody)
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a1');
select throws_ok($$ select private.team_candidates((select a from ids), (select color from ids), now() + interval '1 day') $$, '42501', null, 'the helper is not callable by an owner');
select pg_temp.as_service();
select is(cardinality(private.team_candidates((select a from ids), (select color from ids), now() + interval '1 day')), 3, 'with no restriction all three people can do the service');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a2');
select throws_ok($$ select public.set_service_staff((select color from ids), array[(select noam from team)]) $$, '42501', null, 'staff cannot restrict a service');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a1');
select throws_ok($$ select public.set_service_staff((select color from ids), array[(select pb from ids)]) $$, 'P0001', 'resource_mismatch', 'a person of another business is refused');
select throws_ok($$ select public.set_service_staff((select sb from ids), array[(select pb from ids)]) $$, '42501', null, 'and another business'' service is out of reach');
select is((select public.set_service_staff((select color from ids), array[(select noam from team), (select noam from team)])), 1, 'only Noam colours (duplicates collapse)');
select throws_ok($$ insert into public.service_staff (service_id, resource_id, business_id) values ((select cut from ids), (select dana from team), (select a from ids)) $$, '42501', null, 'the table itself is not writable by owners');
select pg_temp.as_service();
select is(private.team_candidates((select a from ids), (select color from ids), now() + interval '1 day'), array[(select noam from team)], 'now only Noam can do it');
select is(cardinality(private.team_candidates((select a from ids), (select cut from ids), now() + interval '1 day')), 3, 'the other service is unaffected');
select is((public.public_catalog('tm-alpha') -> 'services' -> 1 -> 'staffIds'), to_jsonb(array[(select noam from team)]), 'the public catalog tells who can do it');
select is(cardinality(private.team_candidates((select a from ids), (select color from ids), now() + interval '1 day', array[(select p0 from ids), (select dana from team)])), 0, 'a caller-supplied list cannot add people who may not do the service');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a1');
select is((select public.set_service_staff((select color from ids), '{}')), 0, 'an empty list lifts the restriction');
select pg_temp.as_service();
select is(cardinality(private.team_candidates((select a from ids), (select color from ids), now() + interval '1 day')), 3, 'everybody again');

-- ================================================================ TEAM-05/06: assignment and the race
create function pg_temp.book(p_start timestamptz, p_phone text, p_people uuid[] default null, p_chosen boolean default false, p_service uuid default null) returns jsonb language sql as $$
  select public.public_book_team((select a from ids), coalesce(p_service, (select cut from ids)), p_start, 'לקוח ' || p_phone, p_phone, null, 'business', '{}', 'k-' || p_phone, 'h-' || p_phone, p_people, p_chosen)
$$;
create function pg_temp.who(p_id text) returns uuid language sql as $$ select resource_id from public.appointments where id = p_id::uuid $$;
select pg_temp.as_service();
create temp table t1 as select (select day from ids) + interval '10 hours' as s;
grant select on t1 to service_role, authenticated;
create temp table r1 as select pg_temp.book((select s from t1), '+972508000001') as j;
create temp table r2 as select pg_temp.book((select s from t1), '+972508000002') as j;
create temp table r3 as select pg_temp.book((select s from t1), '+972508000003') as j;
grant select on r1, r2, r3 to service_role, authenticated;
select is((select (j ->> 'resourceId')::uuid from r1), (select p0 from ids), 'first booking: nobody has appointments that day, so the first position (default person) gets it');
select is((select (j ->> 'resourceId')::uuid from r2), (select noam from team), 'same time again: the default person is busy, so the next person gets it');
select is((select (j ->> 'resourceId')::uuid from r3), (select dana from team), 'a third at the same time: the third person');
select throws_ok($$ select pg_temp.book((select s from t1), '+972508000004') $$, 'P0001', 'slot_taken', 'a fourth at the same time: nobody is free → slot_taken');
select is((select count(*)::int from public.appointments where business_id = (select a from ids) and starts_at = (select s from t1)), 3, 'exactly three appointments, none duplicated');
select is((select count(distinct resource_id)::int from public.appointments where business_id = (select a from ids) and starts_at = (select s from t1)), 3, 'on three different people (the constraint, not luck)');
select is((select resource_chosen from public.appointments where id = (select (j ->> 'id')::uuid from r1)), false, '"whoever is free" is remembered as not chosen');

-- fewest appointments that day first, then position
create temp table t2 as select (select day from ids) + interval '13 hours' as s;
grant select on t2 to service_role;
select is((select (pg_temp.book((select s from t2), '+972508000005') ->> 'resourceId')::uuid), (select p0 from ids), 'afternoon: everyone has one that day → position decides (default person) ... ');
select is((select (pg_temp.book((select s from t2), '+972508000006') ->> 'resourceId')::uuid), (select noam from team), '... and then the default person is busy at that time');
create temp table t3 as select (select day from ids) + interval '15 hours' as s;
grant select on t3 to service_role;
-- counts that day: default 2, Noam 2, Dana 1 → Dana (fewest) must get the next one even though she is last by position
select is((select (pg_temp.book((select s from t3), '+972508000007') ->> 'resourceId')::uuid), (select dana from team), 'fewest appointments that day wins over position (Dana has one fewer)');

-- a named person: only that person, never silently someone else
create temp table t4 as select (select day from ids) + interval '16 hours' as s;
grant select on t4 to service_role;
create temp table r4 as select pg_temp.book((select s from t4), '+972508000008', array[(select dana from team)], true) as j;
grant select on r4 to service_role, authenticated;
select is((select (j ->> 'resourceId')::uuid from r4), (select dana from team), 'a named person gets it');
select is((select resource_chosen from public.appointments where id = (select (j ->> 'id')::uuid from r4)), true, 'and it is remembered as chosen');
select throws_ok($$ select pg_temp.book((select s from t4), '+972508000009', array[(select dana from team)], true) $$, 'P0001', 'slot_taken', 'the same person at the same time is taken, even though others are free (negative control)');
select is((select (pg_temp.book((select s from t4), '+972508000010') ->> 'resourceId')::uuid), (select p0 from ids), 'while "whoever is free" at the same time still succeeds on another person');
select is((select (pg_temp.book((select s from t4) + interval '1 hour', '+972508000011', array[(select pb from ids), (select noam from team)]) ->> 'resourceId')::uuid), (select noam from team), 'a person of another business in the list is ignored');
select throws_ok($$ select pg_temp.book((select s from t4) + interval '2 hours', '+972508000012', array[(select pb from ids)], true) $$, 'P0001', 'slot_taken', 'a list of only foreign people leaves nobody → refused');
select is(pg_temp.book((select s from t4) + interval '1 hour', '+972508000011', array[(select pb from ids), (select noam from team)]) -> 'replay', 'true'::jsonb, 'BKG-04: the same key and request is a replay, not a second booking');

-- the old single-person entry point keeps working for a one-person case
select is((select (public.public_book((select b from ids), (select sb from ids), (select day from ids) + interval '10 hours', 'לקוח', '+972508000020', null, 'business', '{}', 'k-old-00001', 'h-old') ->> 'status')), 'confirmed', 'the 10-argument public_book still works');
select pg_temp.as_system();
select is((select resource_id from public.appointments where business_id = (select b from ids)), (select pb from ids), 'and books the only person');

-- busy list names the person
select pg_temp.as_service();
select is((select count(*)::int from public.public_busy((select a from ids), (select s from t1), (select s from t1) + interval '30 minutes') where resource_id is not null), 3, 'public_busy returns the person for each busy range');

-- ================================================================ TEAM-07: customer reschedule keeps the person
select pg_temp.as_service();
create temp table t5 as select (select day from ids) + interval '17 hours' as s;
grant select on t5 to service_role, authenticated;
-- r4 (Dana, chosen). Make Dana busy at t5 and Noam free there: the chosen customer must be refused, not handed to Noam
select pg_temp.book((select s from t5), '+972508000030', array[(select dana from team)], true);
select throws_ok($$ select public.public_reschedule((select (j ->> 'id')::uuid from r4), (select s from t5)) $$, 'P0001', 'slot_taken', 'chosen=true: the named person is busy at the new time → refused (never silently another person)');
select is((select resource_id from public.appointments where id = (select (j ->> 'id')::uuid from r4)), (select dana from team), 'and the appointment still belongs to her');
-- r3 was "whoever" and sits with Dana at t1; make Dana busy at t5 → the not-chosen one may switch
select lives_ok($$ select public.public_reschedule((select (j ->> 'id')::uuid from r3), (select s from t5)) $$, 'chosen=false: moves to the new time on whoever is free');
select isnt((select resource_id from public.appointments where id = (select (j ->> 'id')::uuid from r3)), (select dana from team), 'and it switched because her own person was busy');
select is((select count(*)::int from public.appointments where resource_id = (select dana from team) and starts_at = (select s from t5)), 1, 'Dana still has exactly her own booking at that time');
create temp table t6 as select (select day from ids) + interval '18 hours' as s;
grant select on t6 to service_role, authenticated;
select lives_ok($$ select public.public_reschedule((select (j ->> 'id')::uuid from r4), (select s from t6)) $$, 'chosen=true: when the same person is free it moves and keeps her');
select is((select resource_id from public.appointments where id = (select (j ->> 'id')::uuid from r4)), (select dana from team), 'still Dana');

-- ================================================================ TEAM-08: the owner moves a booking to another person
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a2');
select throws_ok($$ select public.owner_move_appointment((select (j ->> 'id')::uuid from r4), (select s from t6), false, (select noam from team)) $$, '42501', null, 'staff cannot move');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1b1');
select throws_ok($$ select public.owner_move_appointment((select (j ->> 'id')::uuid from r4), (select s from t6), false, (select pb from ids)) $$, '42501', null, 'another business cannot move it');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a1');
select throws_ok($$ select public.owner_move_appointment((select (j ->> 'id')::uuid from r4), (select s from t6), false, (select pb from ids)) $$, 'P0001', 'resource_mismatch', 'a person of another business is refused');
select throws_ok($$ select public.owner_move_appointment((select (j ->> 'id')::uuid from r4), (select s from t6), false, (select dana from team)) $$, 'P0001', 'same_slot', 'same time and same person is no move');
select lives_ok($$ select public.owner_move_appointment((select (j ->> 'id')::uuid from r4), (select s from t6), false, (select noam from team)) $$, 'same time, other person: allowed');
select is((select resource_id from public.appointments where id = (select (j ->> 'id')::uuid from r4)), (select noam from team), 'the appointment is now Noam''s');
select is((select resource_chosen from public.appointments where id = (select (j ->> 'id')::uuid from r4)), true, 'and counts as chosen now');
select throws_ok($$ select public.owner_move_appointment((select (j ->> 'id')::uuid from r3), (select s from t1), false, (select p0 from ids)) $$, 'P0001', 'slot_taken', 'moving onto a person who is busy then is refused (ATOMIC)');
select is((select starts_at from public.appointments where id = (select (j ->> 'id')::uuid from r3)), (select s from t5), 'and the old time is still held');
select pg_temp.as_system();
select throws_ok($$ update public.appointments set resource_id = (select dana from team) where id = (select (j ->> 'id')::uuid from r4) $$, 'P0001', 'appointment_immutable', 'direct reassignment outside a move is still blocked by the guard');

-- ================================================================ TEAM-09: deactivation
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a1');
select is((select (public.update_staff((select dana from team), null, false) ->> 'futureAppointments')::int), 2, 'deactivating tells how many future appointments she still has');
select pg_temp.as_system();
select is((select count(*)::int from public.appointments where resource_id = (select dana from team) and starts_at > now()), 2, 'nothing moved silently');
select pg_temp.as_service();
select is((public.public_catalog('tm-alpha') -> 'team'), jsonb_build_array(jsonb_build_object('id', (select p0 from ids), 'name', (select name from public.resources where id = (select p0 from ids))), jsonb_build_object('id', (select noam from team), 'name', 'נועם')), 'the public team no longer lists her');
select throws_ok($$ select pg_temp.book((select day from ids) + interval '19 hours', '+972508000040', array[(select dana from team)], true) $$, 'P0001', 'slot_taken', 'nobody can book her any more');
select isnt((select (pg_temp.book((select day from ids) + interval '19 hours', '+972508000041') ->> 'resourceId')::uuid), (select dana from team), '"whoever is free" never picks her');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a1');
select lives_ok($$ select public.update_staff((select dana from team), null, true) $$, 'she can be reactivated');

-- ================================================================ TEAM-10: waitlist per person
select pg_temp.as_service();
create temp table t7 as select (select day from ids) + interval '9 hours' + interval '1 day' as s;
grant select on t7 to service_role, authenticated;
create temp table wb as select pg_temp.book((select s from t7), '+972508000050', array[(select noam from team)], true) as j;
grant select on wb to service_role, authenticated;
select lives_ok($$ select public.waitlist_join((select a from ids), (select cut from ids), ((select s from t7) at time zone 'Asia/Jerusalem')::date, null, null, 'ממתין', '+972508000051', 'w@example.com') $$, 'a customer waits for that day');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a1');
select lives_ok($$ select public.transition_appointment((select (j ->> 'id')::uuid from wb), 'cancel') $$, 'the owner cancels Noam''s appointment');
select pg_temp.as_system();
select is((select resource_id from public.waitlist_offers where status = 'pending' and slot_starts_at = (select s from t7)), (select noam from team), 'the offer holds NOAM''s slot');
select pg_temp.as_service();
select throws_ok($$ select pg_temp.book((select s from t7), '+972508000052', array[(select noam from team)], true) $$, 'P0001', 'slot_taken', 'the public cannot take the person''s offered slot (WLT-01 per person)');
select is((select count(*)::int from public.public_busy((select a from ids), (select s from t7), (select s from t7) + interval '30 minutes') where resource_id = (select noam from team)), 1, 'the offer shows up as busy for that person only');
select is((select (pg_temp.book((select s from t7), '+972508000053', array[(select p0 from ids)], true) ->> 'resourceId')::uuid), (select p0 from ids), 'another person at the same time is not held by the offer (negative control)');
select is((select (public.waitlist_accept((select id from public.waitlist_offers where status = 'pending' and slot_starts_at = (select s from t7))) ->> 'outcome')), 'accepted', 'the waiting customer accepts');
select pg_temp.as_system();
select is((select resource_id from public.appointments a join public.customers c on c.id = a.customer_id where c.phone = '+972508000051'), (select noam from team), 'and is booked on the person whose slot it was');

-- ================================================================ TEAM-13: isolation and guardrails
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a1');
select throws_ok($$ select public.create_manual_appointment_team((select a from ids), (select cut from ids), (select day from ids) + interval '20 hours', 'ידני', '+972508000060', null, false, (select pb from ids)) $$, 'P0001', 'resource_mismatch', 'manual booking for another business'' person is refused');
select lives_ok($$ select public.create_manual_appointment_team((select a from ids), (select cut from ids), (select day from ids) + interval '20 hours', 'ידני', '+972508000060', null, false, (select noam from team)) $$, 'manual booking for a named person works');
select is((select resource_chosen from public.appointments a join public.customers c on c.id = a.customer_id where c.phone = '+972508000060'), true, 'and is remembered as chosen');
select throws_ok($$ select public.create_manual_appointment_team((select a from ids), (select cut from ids), (select day from ids) + interval '20 hours', 'ידני', '+972508000061', null, false, (select noam from team)) $$, 'P0001', 'slot_taken', 'the same person at the same time is taken');
select lives_ok($$ select public.create_manual_appointment_team((select a from ids), (select cut from ids), (select day from ids) + interval '20 hours', 'ידני', '+972508000061', null, false, null) $$, 'without a person the order picks one who is free');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c1b1');
select is((select count(*)::int from public.service_staff), 0, 'owner B sees no rows of business A');
select is((select count(*)::int from public.resources where business_id = (select a from ids)), 0, 'nor A''s people');
select pg_temp.as_anon();
select throws_ok($$ select public.public_book_team((select a from ids), (select cut from ids), now() + interval '30 days', 'x', '+972508000070', null, 'business', '{}', 'k', 'h', null, false) $$, '42501', null, 'anon cannot call the team booking directly');
select throws_ok($$ select * from public.service_staff $$, '42501', null, 'anon cannot read service_staff');
select pg_temp.as_system();
-- the old single-person assumption must be gone from every function except the ones that create/seed the default person
select is((select coalesce(string_agg(n.nspname || '.' || p.proname, ', '), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'private') and p.prosrc ~* 'is_default' and p.proname not in ('create_business_impl', 'replace_weekly_hours_impl', 'waitlist_offers_default_person')), '', 'no other function still assumes "the one default person"');
select is((select count(*)::int from private.lint_violations()), 0, 'lint_violations stays empty');

select * from finish();
rollback;
