-- pgTAP: owner operations (manual appointments AVL-09/10, complete/no_show timing, tenant isolation SEC-01).
begin;
select * from no_plan();

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000003a1', 'authenticated', 'authenticated', 'o-owner@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000003a2', 'authenticated', 'authenticated', 'o-staff@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000003b1', 'authenticated', 'authenticated', 'o-other@example.com', now(), '{}', '{}', now(), now());

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

select pg_temp.as_user('00000000-0000-0000-0000-0000000003a1');
select lives_ok($$ select public.create_business('מספרה א', 'barber', null, 'ops-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]',
  '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner A creates a business');
select pg_temp.as_user('00000000-0000-0000-0000-0000000003b1');
select lives_ok($$ select public.create_business('מספרה ב', 'barber', null, 'ops-beta', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]',
  '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner B creates a business');
select pg_temp.as_system();
insert into public.business_members (business_id, user_id, role) select id, '00000000-0000-0000-0000-0000000003a2', 'staff' from public.businesses where slug = 'ops-alpha';

create temp table ids as select
  (select id from public.businesses where slug = 'ops-alpha') as a,
  (select id from public.businesses where slug = 'ops-beta') as b,
  (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'ops-alpha') as sa,
  (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'ops-beta') as sb,
  date_trunc('day', now()) + interval '5 days' as day;
grant select on ids to authenticated, anon;

-- ---------- manual appointments ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000003a1');
select is((public.create_manual_appointment((select a from ids), (select sa from ids), (select day from ids) + interval '3 hours', 'לקוח טלפוני', '+972501112223', 'מגיע עם ילד', true))->>'status', 'confirmed',
  'AVL-10: the owner books a manual appointment (outside opening hours) and it is confirmed');
select is((select source || '|' || out_of_availability::text || '|' || owner_note from public.appointments where business_id = (select a from ids)), 'manual|true|מגיע עם ילד', 'the appointment records that it is manual, out-of-hours and its note');
select throws_ok($$ select public.create_manual_appointment((select a from ids), (select sa from ids), (select day from ids) + interval '3 hours 10 minutes', 'אחר', '+972501112224', null, false) $$, 'P0001', 'slot_taken', 'overlap is impossible even for the owner (EXCLUDE)');
select lives_ok($$ select public.create_manual_appointment((select a from ids), (select sa from ids), (select day from ids) + interval '9 hours', 'לקוח טלפוני', '+972501112223', null, false) $$, 'a returning phone number reuses the customer');
select is((select count(*)::int from public.customers where business_id = (select a from ids)), 1, 'one customer row per phone (BKG-05)');
select throws_ok($$ select public.create_manual_appointment((select a from ids), (select sa from ids), now() - interval '3 days', 'ישן', '+972501112225', null, false) $$, 'P0001', 'slot_in_past', 'more than 24h in the past is refused');
select throws_ok($$ select public.create_manual_appointment((select a from ids), (select sa from ids), (select day from ids) + interval '12 hours', 'א', '+972501112226', null, false) $$, '23514', 'invalid_name', 'a one-letter name is refused');
select throws_ok($$ select public.create_manual_appointment((select a from ids), (select sb from ids), (select day from ids) + interval '12 hours', 'חבר', '+972501112227', null, false) $$, 'P0001', 'service_unavailable', 'a service of another business cannot be used');

-- ---------- permissions & tenant isolation ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000003a2');
select lives_ok($$ select public.create_manual_appointment((select a from ids), (select sa from ids), (select day from ids) + interval '14 hours', 'נוסף', '+972501112228', null, false) $$, 'staff may create manual appointments');
select pg_temp.as_user('00000000-0000-0000-0000-0000000003b1');
select throws_ok($$ select public.create_manual_appointment((select a from ids), (select sa from ids), (select day from ids) + interval '15 hours', 'זר', '+972501112229', null, false) $$, '42501', 'forbidden', 'SEC-01: another business owner cannot create appointments here');
select is((select count(*)::int from public.appointments), 0, 'SEC-01: another business owner sees none of these appointments');
select is((select count(*)::int from public.customers), 0, 'SEC-01: nor the customers');
select pg_temp.as_anon();
select throws_ok($$ select public.create_manual_appointment((select a from ids), (select sa from ids), (select day from ids) + interval '16 hours', 'אנונימי', '+972501112230', null, false) $$, '42501', null, 'anonymous callers cannot call it');

-- ---------- complete / no_show only after the appointment began ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000003a1');
create temp table appt as select (public.create_manual_appointment((select a from ids), (select sa from ids), now() - interval '2 hours', 'עבר', '+972501119999', null, false))->>'id' as past,
                                  (select id::text from public.appointments where starts_at > now() order by starts_at limit 1) as future;
grant select on appt to authenticated;
select throws_ok($$ select public.transition_appointment((select future::uuid from appt), 'complete') $$, 'P0001', 'too_early', 'a future appointment cannot be marked completed');
select throws_ok($$ select public.transition_appointment((select future::uuid from appt), 'no_show') $$, 'P0001', 'too_early', 'nor as a no-show');
select is((public.transition_appointment((select past::uuid from appt), 'no_show'))->>'status', 'no_show', 'a started appointment can be marked no-show');
select throws_ok($$ select public.transition_appointment((select past::uuid from appt), 'complete') $$, 'P0001', 'invalid_transition', 'a no-show cannot become completed');
select is((public.transition_appointment((select future::uuid from appt), 'cancel'))->>'status', 'cancelled_by_business', 'the owner can cancel an upcoming appointment');
select throws_ok($$ select public.transition_appointment((select future::uuid from appt), 'cancel') $$, 'P0001', 'invalid_transition', 'cancelling twice is refused, not silently repeated');

-- ---------- immutability of the new facts ----------
select pg_temp.as_system();
select throws_ok($$ update public.appointments set source = 'online' where id = (select past::uuid from appt) $$, 'P0001', 'appointment_immutable', 'source cannot be rewritten');
select throws_ok($$ update public.appointments set out_of_availability = true where id = (select past::uuid from appt) $$, 'P0001', 'appointment_immutable', 'the out-of-hours flag cannot be rewritten');
select throws_ok($$ update public.appointments set owner_note = 'x' where id = (select past::uuid from appt) $$, 'P0001', 'appointment_immutable', 'the note cannot be rewritten');

-- ---------- audit ----------
select ok((select count(*) from public.audit_log where business_id = (select a from ids) and action = 'appointment.manual_create') >= 3, 'manual creations are audited');
select is((select count(*)::int from public.audit_log where action = 'appointment.no_show' and business_id = (select a from ids)), 1, 'the no-show is audited exactly once');

select * from finish();
rollback;
