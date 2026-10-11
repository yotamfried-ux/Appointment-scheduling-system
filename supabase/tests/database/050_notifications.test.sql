-- pgTAP: notifications (NTF-01/02/03/04/05/06/12), job idempotency (OPS-05), privileges and tenant isolation.
begin;
select * from no_plan();

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000004a1', 'authenticated', 'authenticated', 'n-owner@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000004b1', 'authenticated', 'authenticated', 'n-other@example.com', now(), '{}', '{}', now(), now());

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

-- These tests assume an empty outbox (rolled back at the end): a database used by earlier E2E runs holds due rows that would be claimed too.
delete from public.notification_log;
delete from public.domain_events;
delete from public.appointments;   -- the reminder window counts every business's appointments

select pg_temp.as_user('00000000-0000-0000-0000-0000000004a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'ntf-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]',
  '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner A creates a business');
select pg_temp.as_user('00000000-0000-0000-0000-0000000004b1');
select lives_ok($$ select public.create_business('מספרה ב', 'barber', null, 'ntf-beta', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]',
  '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner B creates a business');
select pg_temp.as_system();
update public.businesses set published_at = now();

create temp table ids as select
  (select id from public.businesses where slug = 'ntf-alpha') as a,
  (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'ntf-alpha') as sa,
  date_trunc('day', now()) + interval '3 days' as day;
grant select on ids to authenticated, service_role;

-- Appointments are created the real way (public_book) and then given known e-mail addresses.
select pg_temp.as_service();
create function pg_temp.book(p_start timestamptz, p_phone text, p_email text, p_key text) returns uuid language sql as $$
  select (public.public_book((select a from ids), (select sa from ids), p_start, 'לקוח ' || p_phone, p_phone, p_email, 'business', '{}', p_key, p_key)->>'id')::uuid
$$;
create temp table appts as select
  pg_temp.book((select day from ids) + interval '10 hours', '+972501000001', 'one@example.com', 'ntf-key-0001') as one,
  pg_temp.book((select day from ids) + interval '11 hours', '+972501000002', null, 'ntf-key-0002') as noemail,
  pg_temp.book((select day from ids) + interval '12 hours', '+972501000003', 'three@example.com', 'ntf-key-0003') as three;
grant select on appts to authenticated, service_role;
select pg_temp.as_system();

-- ---------- privileges: only the system path ----------
select pg_temp.as_anon();
select throws_ok($$ select public.notif_enqueue((select one from appts), 'booking_confirmed', 'customer') $$, '42501', null, 'anon cannot enqueue');
select throws_ok($$ select * from public.notif_claim(5) $$, '42501', null, 'anon cannot claim');
select pg_temp.as_user('00000000-0000-0000-0000-0000000004a1');
select throws_ok($$ select public.notif_enqueue((select one from appts), 'booking_confirmed', 'customer') $$, '42501', null, 'an authenticated owner cannot enqueue directly');
select throws_ok($$ select public.notif_context(gen_random_uuid()) $$, '42501', null, 'nor read the system context (it contains addresses)');
select throws_ok($$ select public.enqueue_reminders(now()) $$, '42501', null, 'nor run the reminder job');
select throws_ok($$ select * from public.outbox_claim(5) $$, '42501', null, 'nor claim outbox events');
select pg_temp.as_system();

-- ---------- NTF-01: exactly once ----------
select pg_temp.as_service();
select isnt((select public.notif_enqueue((select one from appts), 'booking_confirmed', 'customer')), null, 'the first enqueue creates a row');
select is((select public.notif_enqueue((select one from appts), 'booking_confirmed', 'customer')), null, 'NTF-01: the same message again creates nothing');
select is((select count(*)::int from public.notification_log where appointment_id = (select one from appts) and type = 'booking_confirmed'), 1, 'NTF-01: still exactly one row');
select throws_ok($$ select public.notif_enqueue((select one from appts), 'weird', 'customer') $$, '23514', null, 'unknown notification types are refused');
select is((select public.notif_enqueue(gen_random_uuid(), 'booking_confirmed', 'customer')), null, 'an unknown appointment yields nothing');

-- ---------- claim: leased, counted, never twice ----------
create temp table claimed as select * from public.notif_claim(10);
grant select on claimed to service_role;
select is((select count(*)::int from claimed), 1, 'the pending row is claimed');
select is((select status || ':' || attempts::text from claimed), 'sending:1', 'it is marked as sending with one attempt');
select is((select count(*)::int from public.notif_claim(10)), 0, 'a second runner finds nothing: the row is leased');
select ok((select next_attempt_at > now() + interval '4 minutes' from public.notification_log where id = (select id from claimed)), 'the lease lasts about 5 minutes (a crashed runner is retried later)');

-- ---------- context: what the sender needs and nothing more ----------
select is((select public.notif_context((select id from claimed))->'customer'->>'email'), 'one@example.com', 'context carries the customer address for the system path');
select is((select public.notif_context((select id from claimed))->'owner'->>'email'), 'n-owner@example.com', 'and the owner address');
select is((select public.notif_context((select id from claimed))->'business'->>'kind'), 'barber', 'and the business kind (privacy rules)');

-- ---------- finish: sent / retry / dead / skipped ----------
select public.notif_finish((select id from claimed), 'retry', 'fake', null, 'timeout', null, 'h1', null, 120);
select is((select status from public.notification_log where id = (select id from claimed)), 'failed', 'NTF-04: a transient failure schedules a retry');
select ok((select next_attempt_at > now() + interval '100 seconds' from public.notification_log where id = (select id from claimed)), 'NTF-04: with a backoff');
select is((select count(*)::int from public.notif_claim(10)), 0, 'a backing-off row is not claimed early');
select pg_temp.as_system();
update public.notification_log set next_attempt_at = now() - interval '1 second' where id = (select id from claimed);
select pg_temp.as_service();
select is((select attempts from public.notif_claim(10)), 2, 'after the backoff it is claimed again (attempt 2)');
select public.notif_finish((select id from claimed), 'sent', 'fake', 'msg_123', null, null, 'h1', '{"subject":"x"}', 60);
select is((select status || ':' || provider_message_id from public.notification_log where id = (select id from claimed)), 'sent:msg_123', 'NTF-12: the provider message id is stored');
select is((select sent_at is not null from public.notification_log where id = (select id from claimed)), true, 'with the send time');
select public.notif_finish((select id from claimed), 'dead', null, null, 'late', null, null, null, 60);
select is((select status from public.notification_log where id = (select id from claimed)), 'sent', 'a finished (sent) message cannot be flipped to dead by a late runner');
select throws_ok($$ select public.notif_finish((select id from claimed), 'exploded', null, null, null, null, null, null, 60) $$, '23514', null, 'unknown outcomes are refused');

-- ---------- NTF-05: suppression ----------
select is((select public.notif_is_suppressed('hash-a')), false, 'an unknown address is not suppressed');
select public.notif_suppress('hash-a', 'bounce', 'msg_123');
select is((select public.notif_is_suppressed('hash-a')), true, 'NTF-05: a bounced address is suppressed');
select lives_ok($$ select public.notif_suppress('hash-a', 'complaint', null) $$, 'suppressing twice is harmless');
select is((select bounced_at is not null from public.notification_log where provider_message_id = 'msg_123'), true, 'the bounce is correlated with the original send');
select throws_ok($$ select public.notif_suppress('hash-b', 'because', null) $$, '23514', null, 'only known reasons are accepted');

-- ---------- reminders: NTF-01/02/06 ----------
select pg_temp.as_system();
update public.appointments set status = 'confirmed' where id in (select one from appts union select noemail from appts union select three from appts) and status = 'pending';
select pg_temp.as_service();
select is((select public.enqueue_reminders((select day from ids) + interval '10 hours' - interval '20 hours')), 3, 'three appointments fall inside the 24h..2h window');
select is((select public.enqueue_reminders((select day from ids) + interval '10 hours' - interval '20 hours')), 0, 'NTF-01: running the job again adds nothing');
select is((select status || ':' || coalesce(skip_reason, '') from public.notification_log where appointment_id = (select one from appts) and type = 'reminder'), 'queued:', 'a normal reminder is queued');
select is((select status || ':' || skip_reason from public.notification_log where appointment_id = (select noemail from appts) and type = 'reminder'), 'skipped:no_email', 'NTF-06: no e-mail address ⇒ a recorded skip, not a silent gap');
select pg_temp.as_system();
-- NTF-02: an appointment created inside its own reminder window is not reminded (the confirmation already says when)
update public.appointments set created_at = starts_at - interval '3 hours' where id = (select three from appts);
delete from public.notification_log where appointment_id = (select three from appts) and type = 'reminder';
select pg_temp.as_service();
select is((select public.enqueue_reminders((select day from ids) + interval '10 hours' - interval '20 hours')), 1, 'the reminder row is recomputed for the late booking');
select is((select skip_reason from public.notification_log where appointment_id = (select three from appts) and type = 'reminder'), 'late_booking', 'NTF-02: a late booking is skipped with a stated reason');
select is((select public.enqueue_reminders((select day from ids) + interval '10 hours' - interval '30 hours')), 0, 'appointments further than 24h away are not reminded yet');
select is((select public.enqueue_reminders((select day from ids) + interval '10 hours' - interval '1 hour')), 0, 'nor those starting within 2 hours');

-- NTF-03: only confirmed appointments are reminded
create temp table c as select pg_temp.book((select day from ids) + interval '14 hours', '+972501000009', 'nine@example.com', 'ntf-key-0009') as id;
grant select on c to service_role;
select pg_temp.as_system();
update public.appointments set status = 'cancelled_by_customer', cancelled_at = now() where id = (select id from c);
select pg_temp.as_service();
select is((select public.enqueue_reminders((select day from ids) + interval '14 hours' - interval '20 hours')), 0, 'NTF-03: the job runs after the cancellation and adds nothing');
select is((select count(*)::int from public.notification_log where appointment_id = (select id from c)), 0, 'NTF-03: a cancelled appointment never gets a reminder row');

-- ---------- jobs: OPS-05 ----------
select is((select public.job_begin('reminders', 'bucket-1')), true, 'the first run of a bucket owns it');
select is((select public.job_begin('reminders', 'bucket-1')), false, 'OPS-05: a second concurrent/duplicate run does not');
select public.job_finish('reminders', 'bucket-1', null);
select is((select public.job_begin('reminders', 'bucket-1')), false, 'a succeeded bucket never runs again');
select public.job_begin('reminders', 'bucket-2');
select public.job_finish('reminders', 'bucket-2', 'boom');
select is((select public.job_begin('reminders', 'bucket-2')), true, 'a failed bucket may be retried');

-- ---------- outbox events from transitions ----------
select pg_temp.as_system();
select pg_temp.as_user('00000000-0000-0000-0000-0000000004a1');
select lives_ok($$ select public.transition_appointment((select three from appts), 'cancel') $$, 'the owner cancels an appointment');
select pg_temp.as_system();
select is((select count(*)::int from public.domain_events where type = 'AppointmentStatusChanged' and payload->>'appointmentId' = (select three::text from appts) and payload->>'to' = 'cancelled_by_business'), 1, 'the transition queued an event for the notifier');
select is((select count(*)::int from public.domain_events where type = 'AppointmentCreated' and payload->>'appointmentId' = (select one::text from appts)), 1, 'booking queued its event');

-- ---------- RLS: owners see status, not secrets; other tenants see nothing ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000004a1');
select ok((select count(*) from public.notification_log) >= 3, 'the owner sees their own notification statuses');
select throws_ok($$ select to_hash from public.notification_log $$, '42501', null, 'but not the address hash');
select throws_ok($$ select preview from public.notification_log $$, '42501', null, 'nor message bodies');
select throws_ok($$ select provider_message_id, error from public.notification_log $$, '42501', null, 'nor provider details');
select throws_ok($$ insert into public.notification_log (business_id, appointment_id, type, recipient) select a, (select one from appts), 'reminder', 'customer' from ids $$, '42501', null, 'owners cannot write the log');
select pg_temp.as_user('00000000-0000-0000-0000-0000000004b1');
select is((select count(*)::int from public.notification_log), 0, 'SEC-01: another business sees no notifications');
select throws_ok($$ select * from public.email_suppressions $$, '42501', null, 'suppressions are system-only');
select pg_temp.as_anon();
select throws_ok($$ select * from public.notification_log $$, '42501', null, 'anon has no access to the log');

select pg_temp.as_system();
select is_empty($$ select * from private.lint_violations() $$, 'schema lint is clean after the stage 6 migration');
select * from finish();
rollback;
