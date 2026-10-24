-- pgTAP: the owner-readable failure code (derived from status/error/bounce/skip) and what stays hidden.
begin;
select * from no_plan();

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000004a1', 'authenticated', 'authenticated', 'n-owner@example.com', now(), '{}', '{}', now(), now());

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
delete from public.waitlist_offers;
delete from public.waitlist_entries;
delete from public.domain_events;
delete from public.appointments;   -- the reminder window counts every business's appointments

select pg_temp.as_user('00000000-0000-0000-0000-0000000004a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'ntf-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]',
  '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner A creates a business');
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
  pg_temp.book((select day from ids) + interval '11 hours', '+972501000002', 'noemail@example.com', 'ntf-key-0002') as noemail,
  pg_temp.book((select day from ids) + interval '12 hours', '+972501000003', 'three@example.com', 'ntf-key-0003') as three;

-- ---------- the code is derived by the database ----------
select pg_temp.as_system();
insert into public.notification_log (business_id, appointment_id, type, recipient, status, attempts, error, skip_reason, bounced_at) values
  ((select a from ids), (select one from appts), 'booking_confirmed', 'customer', 'dead', 1, 'provider 400: invalid_from_address: Invalid from', null, null),
  ((select a from ids), (select one from appts), 'reminder', 'customer', 'dead', 7, 'provider 429', null, null),
  ((select a from ids), (select noemail from appts), 'booking_confirmed', 'customer', 'skipped', 1, null, 'no_email', null),
  ((select a from ids), (select noemail from appts), 'reminder', 'customer', 'dead', 7, 'network', null, null),
  ((select a from ids), (select three from appts), 'booking_confirmed', 'customer', 'sent', 1, null, null, now()),
  ((select a from ids), (select three from appts), 'reminder', 'customer', 'sent', 1, null, null, null);

select is((select failure_code from public.notification_log where type = 'booking_confirmed' and appointment_id = (select one from appts)), 'provider_rejected', 'a provider 400 is "rejected"');
select is((select failure_code from public.notification_log where type = 'reminder' and appointment_id = (select one from appts)), 'rate_limited', 'a provider 429 is "rate limited"');
select is((select failure_code from public.notification_log where type = 'booking_confirmed' and appointment_id = (select noemail from appts)), 'no_email', 'skipped/no_email is its own, calm code');
select is((select failure_code from public.notification_log where type = 'reminder' and appointment_id = (select noemail from appts)), 'unknown', 'any other dead letter is "unknown"');
select is((select failure_code from public.notification_log where type = 'booking_confirmed' and appointment_id = (select three from appts)), 'bounced', 'a bounced address is "bounced"');
select is((select failure_code from public.notification_log where type = 'reminder' and appointment_id = (select three from appts)), null, 'a delivered message has no code');

-- ---------- owners read the code, not the secrets ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000004a1');
select is((select count(*)::int from public.notification_log where failure_code is not null), 5, 'the owner sees the coded rows of their own business');
select lives_ok($$ select offer_id from public.notification_log $$, 'and which offer a row belongs to');
select throws_ok($$ select error from public.notification_log $$, '42501', null, 'but still not the raw provider text');
select throws_ok($$ select to_hash from public.notification_log $$, '42501', null, 'nor the address hash');
select throws_ok($$ update public.notification_log set status = 'sent' $$, '42501', null, 'and cannot write');

select pg_temp.as_system();
select throws_ok($$ update public.notification_log set failure_code = 'x' $$, '428C9', null, 'the code cannot be set by hand');
select is_empty($$ select * from private.lint_violations() $$, 'schema lint is clean');
select * from finish();
rollback;
