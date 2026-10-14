-- pgTAP: NSH-01/02/06, NTF-09/11 — attendance confirmation, one alert for unconfirmed visits, auto-completion, the daily digest (never empty, never at night).
begin;
select * from no_plan();

delete from public.notification_log; delete from public.waitlist_offers; delete from public.waitlist_entries; delete from public.domain_events; delete from public.appointments;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000b1a1', 'authenticated', 'authenticated', 'a-owner@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000b1a2', 'authenticated', 'authenticated', 'a-staff@example.com', now(), '{}', '{}', now(), now());
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true); set local role service_role; end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'at-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner creates a business');
select pg_temp.as_system();
update public.businesses set published_at = now() where slug = 'at-alpha';
insert into public.business_members (business_id, user_id, role) select id, '00000000-0000-0000-0000-00000000b1a2', 'staff' from public.businesses where slug = 'at-alpha';
create temp table ids as select (select id from public.businesses where slug = 'at-alpha') as a, (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'at-alpha') as s1;
grant select on ids to authenticated, service_role;


update public.businesses set min_notice_minutes = 0, attendance_alert_minutes = 120 where slug = 'at-alpha';
select pg_temp.as_service();
create temp table v as select (public.public_book((select a from ids), (select s1 from ids), now() + interval '90 minutes', 'דנה', '+972506660001', 'dana@example.com', 'business', '{}', 'akey-0001', 'ah-1') ->> 'id')::uuid as appt;
create temp table w as select (public.public_book((select a from ids), (select s1 from ids), now() + interval '30 hours', 'גיל', '+972506660002', 'gil@example.com', 'business', '{}', 'akey-0002', 'ah-2') ->> 'id')::uuid as appt;
grant select on v, w to service_role;
select pg_temp.as_system();
update public.appointments set created_at = now() - interval '2 days' where id in (select appt from v union select appt from w);
select pg_temp.as_service();

-- ---- NSH-01: confirming never changes the status; twice is a no-op; a past or cancelled visit cannot be confirmed
select is(public.public_confirm_attendance((select appt from w)) ->> 'outcome', 'confirmed', 'the customer confirms attendance');
select is(public.public_confirm_attendance((select appt from w)) ->> 'outcome', 'already', 'confirming again changes nothing');
select pg_temp.as_system();
select is((select status from public.appointments where id = (select appt from w)), 'confirmed', 'the status is untouched by the confirmation');
select is((select attendance_confirmed_at is not null from public.appointments where id = (select appt from w)), true, 'the time of confirmation is recorded');

-- ---- NSH-02: one alert, for the unconfirmed visit inside the window, and not twice
select pg_temp.as_service();
select is(public.owner_housekeeping(now()) -> 'alerts', '1', 'one alert: the visit in 90 minutes is unconfirmed and inside the 120-minute window (the confirmed one and the far one are not)');
select is(public.owner_housekeeping(now() + interval '5 minutes') -> 'alerts', '0', 'running again alerts nobody a second time');
select pg_temp.as_system();
select is((select count(*)::int from public.notification_log where type = 'owner_unconfirmed' and appointment_id = (select appt from v)), 1, 'the alert row exists once');
update public.businesses set attendance_alert_minutes = 0 where slug = 'at-alpha';
delete from public.notification_log where type = 'owner_unconfirmed';
select pg_temp.as_service();
select is(public.owner_housekeeping(now()) -> 'alerts', '0', 'with the alert switched off nothing is queued');

-- ---- NSH-06: visits the owner never closed are completed by themselves after N hours, only when the business chose that
select pg_temp.as_system();
insert into public.customers (id, business_id, full_name, phone) values ('00000000-0000-0000-0000-0000000000a1', (select a from ids), 'עבר', '+972506660003');
create function pg_temp.past(p_hours_ago int, p_ref text) returns void language plpgsql as $$
begin
  insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, location, intake, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
  select b.id, (select id from public.resources where business_id = b.id and is_default), (select s1 from ids), '00000000-0000-0000-0000-0000000000a1', p_ref, 'confirmed', 'business', '{}'::jsonb,
         now() - make_interval(hours => p_hours_ago), now() - make_interval(hours => p_hours_ago) + interval '30 minutes', now() - make_interval(hours => p_hours_ago) + interval '30 minutes',
         '{"name":"x","durationMinutes":30,"bufferMinutes":0,"priceCents":8000}'::jsonb, 8000, 'ILS' from public.businesses b where b.slug = 'at-alpha';
end $$;
select pg_temp.past(30, 'TR-OLD001'); select pg_temp.past(3, 'TR-NEW001');
select pg_temp.as_service();
select is(public.owner_housekeeping(now()) -> 'autoCompleted', '0', 'off by default: nothing is closed automatically');
select pg_temp.as_system();
update public.businesses set auto_complete_hours = 24 where slug = 'at-alpha';
select pg_temp.as_service();
select is(public.owner_housekeeping(now()) -> 'autoCompleted', '1', 'after 24 hours the old visit is completed');
select pg_temp.as_system();
select is((select status from public.appointments where reference = 'TR-OLD001'), 'completed', 'the 30-hour-old visit is completed (never a no-show: that is the owner''s call)');
select is((select status from public.appointments where reference = 'TR-NEW001'), 'confirmed', 'the 3-hour-old visit is left alone');
select is((select count(*)::int from public.audit_log where business_id = (select a from ids) and action = 'appointments.auto_completed'), 1, 'the automatic closing is audited');

-- ---- NTF-11 / NTF-09: the digest
update public.businesses set digest_frequency = 'daily', attendance_alert_minutes = 120, timezone = 'Asia/Jerusalem' where slug = 'at-alpha';
create temp table local_noon as select (date_trunc('day', now() at time zone 'Asia/Jerusalem') + interval '12 hours') at time zone 'Asia/Jerusalem' as t;
grant select on local_noon to service_role;
select pg_temp.as_system();
insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, location, intake, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
  select b.id, (select id from public.resources where business_id = b.id and is_default), (select s1 from ids), '00000000-0000-0000-0000-0000000000a1', 'TR-TOMOR1', 'confirmed', 'business', '{}'::jsonb,
         (select t from local_noon) + interval '1 day', (select t from local_noon) + interval '1 day 30 minutes', (select t from local_noon) + interval '1 day 30 minutes',
         '{"name":"x","durationMinutes":30,"bufferMinutes":0,"priceCents":8000}'::jsonb, 8000, 'ILS' from public.businesses b where b.slug = 'at-alpha';
select pg_temp.as_service();
select is(public.owner_housekeeping((select t from local_noon)) -> 'digests', '1', 'at local noon the owner gets a digest (something to say: an unmarked visit)');
select is(public.owner_housekeeping((select t from local_noon) + interval '1 hour') -> 'digests', '0', 'only one digest per local day');
select pg_temp.as_system();
delete from public.notification_log where type = 'owner_digest';
select pg_temp.as_service();
select is(public.owner_housekeeping((select t from local_noon) - interval '8 hours') -> 'digests', '0', 'NTF-09: no digest at 04:00 local time');
select is(public.owner_housekeeping((select t from local_noon) + interval '10 hours') -> 'digests', '0', 'NTF-09: no digest at 22:00 local time');
select pg_temp.as_system();
delete from public.appointments where business_id = (select a from ids);
select pg_temp.as_service();
select is(public.owner_housekeeping((select t from local_noon)) -> 'digests', '0', 'NTF-11: nothing to report ⇒ no empty digest');
select pg_temp.as_system();
select is((select public.notif_context((select id from public.notification_log where type = 'owner_digest' limit 1))) is null, true, 'no digest row was left behind');

-- ---- grants: the system only
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select throws_ok($$ select public.owner_housekeeping(now()) $$, '42501', null, 'an owner cannot run the jobs');
select throws_ok($$ select public.public_confirm_attendance((select appt from w)) $$, '42501', null, 'nor confirm attendance on behalf of a customer');
select pg_temp.as_system();
select is((select count(*)::int from private.lint_violations()), 0, 'schema lint stays empty');
select * from finish();
rollback;
