-- pgTAP: public booking (BKG-02/04/05/07/09/10/11, SEC-01/06). The database, not the application, decides conflicts.
begin;
select * from no_plan();

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000002a1', 'authenticated', 'authenticated', 'b-owner@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000002a2', 'authenticated', 'authenticated', 'b-admin@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000002a3', 'authenticated', 'authenticated', 'b-staff@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000002d1', 'authenticated', 'authenticated', 'b-outsider@example.com', now(), '{}', '{}', now(), now());

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
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Business A (barber, no approval) with two services; business C (clinic) to prove the approval default.
select pg_temp.as_user('00000000-0000-0000-0000-0000000002a1');
select lives_ok($$ select public.create_business('מספרת הזמנות', 'barber', null, 'book-alpha',
  '[{"name":"תספורת","durationMinutes":60,"priceNis":100},{"name":"עיצוב","durationMinutes":30,"priceNis":50}]',
  '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]},{"weekday":1,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner creates business A');
select pg_temp.as_user('00000000-0000-0000-0000-0000000002d1');
select lives_ok($$ select public.create_business('קליניקה', 'clinic', null, 'book-clinic', '[{"name":"טיפול","durationMinutes":45,"priceNis":300}]',
  '[{"weekday":0,"open":true,"windows":[{"from":"08:00","to":"16:00"}]}]') $$, 'outsider (as owner of the clinic) creates business C');
select pg_temp.as_system();
insert into public.business_members (business_id, user_id, role) select id, '00000000-0000-0000-0000-0000000002a2', 'admin' from public.businesses where slug = 'book-alpha';
insert into public.business_members (business_id, user_id, role) select id, '00000000-0000-0000-0000-0000000002a3', 'staff' from public.businesses where slug = 'book-alpha';

create temp table ids as select
  (select id from public.businesses where slug = 'book-alpha') as a,
  (select id from public.businesses where slug = 'book-clinic') as c,
  (select s.id from public.services s join public.businesses b on b.id = s.business_id where b.slug = 'book-alpha' and s.name = 'תספורת') as s60,
  (select s.id from public.services s join public.businesses b on b.id = s.business_id where b.slug = 'book-alpha' and s.name = 'עיצוב') as s30,
  (select s.id from public.services s join public.businesses b on b.id = s.business_id where b.slug = 'book-clinic') as sc,
  date_trunc('day', now()) + interval '10 days' as day;       -- far enough ahead for notice/cancel windows, within the 60-day horizon
grant select on ids to authenticated, anon, service_role;
update public.services set buffer_minutes = 10 where id = (select s60 from ids);

select is((select requires_approval from public.businesses where id = (select c from ids)), true, 'BKG-09: a clinic requires manual approval by default');
select is((select requires_approval from public.businesses where id = (select a from ids)), false, 'a barber confirms automatically');

-- ---------- BKG-11: catalogue visibility ----------
select pg_temp.as_service();
select is((select public.public_catalog('book-alpha')), null, 'BKG-11: an unpublished business is invisible (null)');
select is((select public.public_catalog('does-not-exist')), null, 'BKG-11: unknown slug looks identical to an unpublished one');
select pg_temp.as_system();
update public.businesses set published_at = now() where id in ((select a from ids), (select c from ids));
insert into public.services (business_id, name, duration_minutes, price_cents, capacity) values ((select a from ids), 'קבוצתי', 45, 6000, 8);
insert into public.services (business_id, name, duration_minutes, price_cents, active) values ((select a from ids), 'לא פעיל', 20, 1000, false);
select pg_temp.as_service();
select is((select jsonb_array_length(public.public_catalog('book-alpha')->'services')), 2, 'catalogue lists only active single-capacity services');
select is((select public.public_catalog('Book-Alpha')->'business'->>'name'), 'מספרת הזמנות', 'slug lookup is case-insensitive');
select is((select jsonb_array_length(public.public_catalog('book-alpha')->'rules')), 2, 'catalogue includes the weekly rules');
select ok((select public.public_catalog('book-alpha')->'business' ? 'id'), 'catalogue returns the business id (server-side use)');
select is((select public.public_catalog('book-alpha')::text ~ 'phone|created_by|email'), false, 'catalogue never exposes owner contact or identity fields');
select pg_temp.as_system();

-- ---------- BKG-02/04: booking, conflicts, idempotency ----------
create function pg_temp.book(p_service uuid, p_start timestamptz, p_key text, p_hash text default 'h1', p_name text default 'נועם לוי', p_phone text default '+972501234567') returns jsonb
language sql as $$ select public.public_book((select a from ids), p_service, p_start, p_name, p_phone, null, 'business', '{}', p_key, p_hash) $$;
create function pg_temp.book_c(p_start timestamptz, p_key text) returns jsonb
language sql as $$ select public.public_book((select c from ids), (select sc from ids), p_start, 'מטופל', '+972521112223', null, 'business', '{}', p_key, 'hc') $$;

select pg_temp.as_service();
select is((pg_temp.book((select s60 from ids), (select day from ids) + interval '10 hours', 'key-0000001'))->>'status', 'confirmed', 'BKG-02: a booking is created and confirmed');
select is((pg_temp.book((select s60 from ids), (select day from ids) + interval '10 hours', 'key-0000001'))->>'replay', 'true', 'BKG-04: same key + same request ⇒ replay of the SAME appointment');
select throws_ok($$ select pg_temp.book((select s60 from ids), (select day from ids) + interval '10 hours', 'key-0000001', 'other-hash') $$, 'P0001', 'idempotency_reuse', 'BKG-04: same key with a different request is refused');
select throws_ok($$ select pg_temp.book((select s60 from ids), (select day from ids) + interval '10 hours', 'key-0000002') $$, 'P0001', 'slot_taken', 'BKG-02: the same slot with a new key ⇒ slot_taken');
select throws_ok($$ select pg_temp.book((select s30 from ids), (select day from ids) + interval '10 hours 30 minutes', 'key-0000003') $$, 'P0001', 'slot_taken', 'BKG-02: an overlapping start (inside the booking) ⇒ slot_taken');
select throws_ok($$ select pg_temp.book((select s30 from ids), (select day from ids) + interval '11 hours 5 minutes', 'key-0000004') $$, 'P0001', 'slot_taken', 'the service buffer (10 min) is protected: 11:05 collides');
select throws_ok($$ select pg_temp.book((select s30 from ids), (select day from ids) + interval '9 hours 45 minutes', 'key-0000005') $$, 'P0001', 'slot_taken', 'BKG-15: a service ending after the next booking starts is refused');
select is((pg_temp.book((select s30 from ids), (select day from ids) + interval '11 hours 10 minutes', 'key-0000006'))->>'status', 'confirmed', 'adjacent booking right after the buffer is allowed');
select is((pg_temp.book((select s30 from ids), (select day from ids) + interval '9 hours 30 minutes', 'key-0000007'))->>'status', 'confirmed', 'a booking ending exactly when the next starts is allowed');
select pg_temp.as_system();
select is((select count(*)::int from public.appointments where business_id = (select a from ids)), 3, 'only the successful bookings exist (replay and refusals created nothing)');
select is((select count(*)::int from public.booking_idempotency where business_id = (select a from ids)), 3, 'one idempotency record per created booking');

-- direct insert as the table owner: the constraint itself refuses the overlap (not the function)
select throws_ok($$ insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, starts_at, ends_at, blocked_until, service_snapshot, price_cents)
  select a.business_id, a.resource_id, a.service_id, a.customer_id, 'TR-DIRECT', a.starts_at + interval '5 minutes', a.ends_at, a.blocked_until, a.service_snapshot, a.price_cents
  from public.appointments a where a.business_id = (select a from ids) limit 1 $$, '23P01', null, 'BKG-02: the database constraint rejects an overlapping row even without the function');

-- negative control: without the constraint the same insert succeeds (so the constraint is what protects us)
savepoint nc;
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'public.appointments'::regclass and contype = 'x';
  execute format('alter table public.appointments drop constraint %I', c);
end $$;
select lives_ok($$ insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, starts_at, ends_at, blocked_until, service_snapshot, price_cents)
  select a.business_id, a.resource_id, a.service_id, a.customer_id, 'TR-NOEXCL', a.starts_at + interval '5 minutes', a.ends_at, a.blocked_until, a.service_snapshot, a.price_cents
  from public.appointments a where a.business_id = (select a from ids) limit 1 $$, 'negative control: with the EXCLUDE constraint dropped, a double booking is possible');
rollback to savepoint nc;
select is((select count(*)::int from public.appointments where reference = 'TR-NOEXCL'), 0, 'negative control rolled back');

-- ---------- BKG-05/06/07/10 ----------
select pg_temp.as_service();
select is((pg_temp.book((select s30 from ids), (select day from ids) + interval '14 hours', 'key-0000008', 'h8', 'נועם לוי המעודכן'))->>'status', 'confirmed', 'BKG-05: returning customer (same phone, new name) books again');
select pg_temp.as_system();
select is((select count(*)::int from public.customers where business_id = (select a from ids) and phone = '+972501234567'), 1, 'BKG-05: one customer row per phone');
select is((select full_name from public.customers where business_id = (select a from ids) and phone = '+972501234567'), 'נועם לוי המעודכן', 'BKG-05: the latest name is kept');
select pg_temp.as_service();
select lives_ok($$ select pg_temp.book((select s30 from ids), (select day from ids) + interval '15 hours', 'key-0000009', 'h9') $$, '5th future booking of the same phone');
select throws_ok($$ select pg_temp.book((select s30 from ids), (select day from ids) + interval '16 hours', 'key-0000010', 'h10') $$, 'P0001', 'booking_limit', 'BKG-07: the 6th future booking is refused');
select lives_ok($$ select pg_temp.book((select s30 from ids), (select day from ids) + interval '16 hours', 'key-0000011', 'h11', 'אחר', '+972529998887') $$, 'another phone is not affected by the limit');
update public.services set active = false where id = (select s30 from ids);
select throws_ok($$ select pg_temp.book((select s30 from ids), (select day from ids) + interval '17 hours', 'key-0000012', 'h12') $$, 'P0001', 'service_unavailable', 'BKG-10: a deactivated service cannot be booked');
select pg_temp.as_system();
update public.services set active = true where id = (select s30 from ids);
select pg_temp.as_service();
select throws_ok($$ select pg_temp.book((select s30 from ids), now() + interval '10 minutes', 'key-0000013', 'h13', 'צעיר', '+972531112223') $$, 'P0001', 'slot_in_past', 'a start inside the minimum notice is refused');
select throws_ok($$ select pg_temp.book((select s30 from ids), now() + interval '200 days', 'key-0000014', 'h14', 'רחוק', '+972531112224') $$, 'P0001', 'slot_too_far', 'a start beyond the booking horizon is refused');
select throws_ok($$ select public.public_book((select a from ids), (select sc from ids), (select day from ids) + interval '9 hours', 'חוצה', '+972531112225', null, 'business', '{}', 'key-0000015', 'h15') $$, 'P0001', 'service_unavailable', 'a service of ANOTHER business cannot be booked through this business');
select throws_ok($$ select public.public_book((select a from ids), (select s30 from ids), (select day from ids) + interval '9 hours', 'x', '050', null, 'business', '{}', 'key-0000016', 'h16') $$, '23514', null, 'an invalid phone/name is refused by the database too');
select pg_temp.as_system();

-- location + intake are stored for the provider and constrained
select pg_temp.as_service();
select throws_ok($$ select public.public_book((select a from ids), (select s30 from ids), (select day from ids) + interval '12 hours', 'מיקום', '+972551112223', null, 'teleport', '{}', 'key-loc-0001', 'hl') $$, '23514', null, 'an unknown location is refused by the database');
select throws_ok($$ select public.public_book((select a from ids), (select s30 from ids), (select day from ids) + interval '12 hours', 'מיקום', '+972551112223', null, 'business', '[]', 'key-loc-0002', 'hl2') $$, '23514', null, 'intake must be an object');
select is((public.public_book((select a from ids), (select s30 from ids), (select day from ids) + interval '12 hours', 'עם הערות', '+972551112224', null, 'online', '{"goal":"כושר"}', 'key-loc-0003', 'hl3'))->>'status', 'confirmed', 'a booking with location and intake is stored');
select pg_temp.as_system();
select is((select intake->>'goal' from public.appointments where location = 'online' and business_id = (select a from ids)), 'כושר', 'intake is stored for the provider');
select throws_ok($$ update public.appointments set intake = '{}' where location = 'online' $$, 'P0001', 'appointment_immutable', 'intake cannot be rewritten afterwards');
select is((select count(*)::int from public.domain_events where business_id = (select a from ids) and type = 'AppointmentCreated' and payload::text ~ 'כושר'), 0, 'intake never leaks into outbox payloads (messages)');

-- ---------- BKG-09: manual approval ----------
select pg_temp.as_service();
select is((pg_temp.book_c((select day from ids) + interval '9 hours', 'key-clinic-01'))->>'status', 'pending', 'BKG-09: a clinic booking is created as pending');
select pg_temp.as_system();

-- ---------- snapshot, immutability, state machine ----------
update public.services set price_cents = 99999, name = 'שם חדש' where id = (select s60 from ids);
select is((select service_snapshot->>'name' from public.appointments where reference is not null and service_id = (select s60 from ids) limit 1), 'תספורת', 'the service snapshot is unaffected by later edits');
select is((select price_cents from public.appointments where service_id = (select s60 from ids) limit 1), 10000, 'the price at booking time is kept');
select throws_ok($$ update public.appointments set starts_at = starts_at + interval '1 hour' where business_id = (select a from ids) $$, 'P0001', 'appointment_immutable', 'core fields of an appointment cannot be changed');
select throws_ok($$ update public.appointments set service_snapshot = '{}' where business_id = (select a from ids) $$, 'P0001', 'appointment_immutable', 'the snapshot cannot be rewritten');

-- ---------- customer cancel (policy window) ----------
create temp table appt as select id, starts_at from public.appointments where business_id = (select a from ids) and service_id = (select s60 from ids) order by starts_at limit 1;
grant select on appt to service_role;
select pg_temp.as_service();
select is((select public.public_get_appointment((select id from appt))->>'serviceName'), 'תספורת', 'the appointment view shows the snapshot name');
select is((select public.public_get_appointment(gen_random_uuid())), null, 'unknown appointment ⇒ null');
select pg_temp.as_system();
update public.businesses set cancel_until_hours = 24 * 30 where id = (select a from ids);      -- 30 days: every appointment is inside the window
select pg_temp.as_service();
select throws_ok($$ select public.public_cancel((select id from appt)) $$, 'P0001', 'too_late', 'CXL: cancelling inside the policy window is refused');
select pg_temp.as_system();
update public.businesses set cancel_until_hours = 12 where id = (select a from ids);
select pg_temp.as_service();
select is((select public.public_cancel((select id from appt))->>'status'), 'cancelled_by_customer', 'CXL: cancelling outside the window works');
select throws_ok($$ select public.public_cancel((select id from appt)) $$, 'P0001', 'invalid_transition', 'cancelling twice is refused');
select pg_temp.as_system();
select is((select count(*)::int from public.domain_events where business_id = (select a from ids) and type = 'AppointmentCancelled'), 1, 'cancellation is queued in the outbox');
select is((select count(*)::int from public.domain_events where business_id = (select a from ids) and type = 'AppointmentCreated'), 7, 'every booking is queued in the outbox (replays/refusals are not)');
select pg_temp.as_service();
select is((pg_temp.book((select s60 from ids), (select starts_at from appt), 'key-reuse-slot', 'hr', 'חוזר', '+972541112223'))->>'status', 'confirmed', 'a cancelled slot is bookable again');
select is((select count(*)::int from public.public_busy((select a from ids), (select day from ids), (select day from ids) + interval '1 day') where starts_at = (select starts_at from appt)), 1, 'public_busy lists only ACTIVE appointments (the new one, not the cancelled one)');
select pg_temp.as_system();
select throws_ok($$ update public.appointments set status = 'confirmed' where id = (select id from appt) $$, 'P0001', 'invalid_transition', 'a cancelled appointment cannot be revived');

-- ---------- single-use tokens ----------
select pg_temp.as_service();
select is((select public.public_consume_token('jti-test-0001', now() + interval '1 hour')), true, 'SEC-06: a token id is consumed once');
select is((select public.public_consume_token('jti-test-0001', now() + interval '1 hour')), false, 'SEC-06: the same token id cannot be consumed again');
select pg_temp.as_system();

-- ---------- RLS and function privileges ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000002a3');
select cmp_ok((select count(*)::int from public.appointments), '>', 0, 'staff can read the appointments of their business');
select cmp_ok((select count(*)::int from public.customers), '>', 0, 'staff can read customers of their business');
select is((select count(*)::int from public.appointments where business_id = (select c from ids)), 0, 'SEC-01: staff of A cannot read appointments of C');
select throws_ok($$ insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, starts_at, ends_at, blocked_until, service_snapshot, price_cents) select business_id, resource_id, service_id, customer_id, 'TR-HAX', starts_at + interval '9 days', ends_at + interval '9 days', blocked_until + interval '9 days', service_snapshot, price_cents from public.appointments limit 1 $$, '42501', null, 'clients cannot insert appointments directly');
select throws_ok($$ select public.public_book((select a from ids), (select s60 from ids), now() + interval '20 days', 'ח', '+972501112223', null, 'business', '{}', 'key-authenticated', 'h') $$, '42501', null, 'authenticated users cannot call the public booking function');
select pg_temp.as_anon();
select throws_ok($$ select * from public.appointments $$, '42501', null, 'anon cannot read appointments');
select throws_ok($$ select public.public_catalog('book-alpha') $$, '42501', null, 'anon cannot call the system catalogue function');
select pg_temp.as_user('00000000-0000-0000-0000-0000000002d1');
select is((select count(*)::int from public.appointments where business_id = (select a from ids)), 0, 'SEC-01: an owner of another business cannot read appointments of A');
select is((select count(*)::int from public.customers where business_id = (select a from ids)), 0, 'SEC-01: ...nor customers of A');
select pg_temp.as_system();
select ok(has_function_privilege('service_role', 'public.public_book(uuid,uuid,timestamptz,text,text,text,text,jsonb,text,text)', 'EXECUTE'), 'service_role may call public_book');
select ok(not has_function_privilege('authenticated', 'private.public_book(uuid,uuid,timestamptz,text,text,text,text,jsonb,text,text)', 'EXECUTE'), 'authenticated cannot call private.public_book');

-- ---------- owner transitions ----------
select pg_temp.as_service();
create temp table pend as select (pg_temp.book_c((select day from ids) + interval '13 hours', 'key-clinic-02')->>'id')::uuid as id;
select pg_temp.as_system();
grant select on pend to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000002a3');
select throws_ok($$ select public.transition_appointment((select id from appt), 'complete') $$, '42501', null, 'staff cannot change appointment status');
select pg_temp.as_user('00000000-0000-0000-0000-0000000002a1');
select throws_ok($$ select public.transition_appointment((select id from pend), 'approve') $$, '42501', null, 'the owner of A cannot touch an appointment of C');
select pg_temp.as_user('00000000-0000-0000-0000-0000000002d1');
select is((select public.transition_appointment((select id from pend), 'approve')->>'status'), 'confirmed', 'the clinic owner approves a pending appointment');
select throws_ok($$ select public.transition_appointment((select id from pend), 'approve') $$, 'P0001', 'invalid_transition', 'approving twice is refused by the state machine');
select throws_ok($$ select public.transition_appointment((select id from pend), 'explode') $$, '23514', null, 'an unknown action is refused');
select is((select public.transition_appointment((select id from pend), 'complete')->>'status'), 'completed', 'confirmed → completed');
select pg_temp.as_system();
select is((select count(*)::int from public.audit_log where business_id = (select c from ids) and action like 'appointment.%'), 2, 'owner transitions are audited');

select is_empty($$ select * from private.lint_violations() $$, 'schema lint is clean after the stage 4 migration');
select * from finish();
rollback;
