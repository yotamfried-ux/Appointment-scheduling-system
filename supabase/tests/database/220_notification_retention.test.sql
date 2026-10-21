-- pgTAP: finished messages older than 90 days are removed by maintenance; recent ones and ones still waiting are not.
begin;
select * from no_plan();

delete from public.notification_log; delete from public.domain_events; delete from public.appointments;
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000f1a1', 'authenticated', 'authenticated', 'nl-owner@example.com', now(), '{}', '{}', now(), now());
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'nl-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'a business exists');
select pg_temp.as_system();

insert into public.notification_log (business_id, digest_date, type, recipient, status, to_hash, created_at)
select (select id from public.businesses where slug = 'nl-alpha'), (current_date - d)::date, 'owner_digest', 'owner', st, md5(d::text || st), now() - (d || ' days')::interval
from (values (120, 'sent'), (100, 'dead'), (95, 'skipped'), (99, 'queued'), (101, 'failed'), (10, 'sent'), (3, 'queued')) as v(d, st);

set local role service_role;
select is(public.maintenance_run() ->> 'notificationLog', '3', 'the three finished messages older than 90 days are removed');
select is((select count(*)::int from public.notification_log), 4, 'the recent message and the ones still waiting or retrying stay');
select is((select count(*)::int from public.notification_log where status in ('queued', 'failed')), 3, 'queued and failed messages are never removed, however old');
select is(public.maintenance_run() ->> 'notificationLog', '0', 'running it again removes nothing (idempotent)');
reset role;

select * from finish();
rollback;
