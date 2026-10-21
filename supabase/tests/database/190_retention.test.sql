-- pgTAP: retention rule — a customer idle for 3 years is anonymised by the system job; recent and upcoming customers are untouched; appointment facts stay.
begin;
select * from no_plan();

delete from public.notification_log; delete from public.waitlist_offers; delete from public.waitlist_entries; delete from public.domain_events; delete from public.appointments;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000c1a1', 'authenticated', 'authenticated', 'ret-owner@example.com', now(), '{}', '{}', now(), now());
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true); set local role service_role; end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'ret-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner creates a business');
select pg_temp.as_system();
update public.businesses set published_at = now() where slug = 'ret-alpha';
create temp table ids as select (select id from public.businesses where slug = 'ret-alpha') as a, (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'ret-alpha') as s1;
grant select on ids to authenticated, service_role;

select pg_temp.as_service();
create temp table old_b as select (public.public_book((select a from ids), (select s1 from ids), now() + interval '3 days', 'ישן', '+972505560001', 'old@example.com', 'business', '{}', 'rkey-0001', 'rh-1') ->> 'id')::uuid as appt;
create temp table new_b as select (public.public_book((select a from ids), (select s1 from ids), now() + interval '4 days', 'חדש', '+972505560002', 'new@example.com', 'business', '{}', 'rkey-0002', 'rh-2') ->> 'id')::uuid as appt;
grant select on old_b, new_b to service_role;
select pg_temp.as_system();

-- age the first customer: an old, finished appointment and an old creation date
set local session_replication_role = replica;      -- test fixture only: the immutability trigger rightly refuses moving history
update public.appointments set starts_at = now() - interval '3 years 2 months', ends_at = now() - interval '3 years 2 months' + interval '30 minutes', blocked_until = now() - interval '3 years 2 months' + interval '30 minutes', status = 'completed', owner_note = 'הערה', intake = '{"x":"y"}'::jsonb where id = (select appt from old_b);
set local session_replication_role = origin;
update public.customers set created_at = now() - interval '4 years' where phone = '+972505560001';
update public.customers set created_at = now() - interval '4 years' where phone = '+972505560002';   -- old record, but a future appointment keeps it

select is(public.retention_anonymize(now()), 1, 'exactly the idle customer is anonymised');
select is((select full_name from public.customers where id = (select customer_id from public.appointments where id = (select appt from old_b))), 'לקוח שנמחק', 'the idle customer lost the name');
select is((select email from public.customers where id = (select customer_id from public.appointments where id = (select appt from old_b))), null, 'and the e-mail');
select is((select contact_email from public.appointments where id = (select appt from old_b)), null, 'and the appointment contact e-mail');
select is((select intake from public.appointments where id = (select appt from old_b)), '{}'::jsonb, 'and the intake answers');
select is((select status from public.appointments where id = (select appt from old_b)), 'completed', 'the appointment fact stays');
select is((select full_name from public.customers where phone = '+972505560002'), 'חדש', 'a customer with a future appointment is untouched');
select is(public.retention_anonymize(now()), 0, 'idempotent: a second run changes nothing');
select is((select count(*)::int from public.audit_log where business_id = (select a from ids) and action = 'customer.retention_anonymize'), 1, 'the removal is audited');

select pg_temp.as_user('00000000-0000-0000-0000-00000000c1a1');
select throws_ok($$ select public.retention_anonymize(now()) $$, '42501', null, 'an owner cannot call the system job');
select pg_temp.as_system();

select * from finish();
rollback;
