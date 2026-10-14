-- pgTAP: BKG-08 — no-show policy: off / require_approval / block with a rolling 60-day window, owner override, audited.
begin;
select * from no_plan();

delete from public.notification_log; delete from public.waitlist_offers; delete from public.waitlist_entries; delete from public.domain_events; delete from public.appointments;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000b1a1', 'authenticated', 'authenticated', 'n-owner@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000b1a2', 'authenticated', 'authenticated', 'n-staff@example.com', now(), '{}', '{}', now(), now());
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true); set local role service_role; end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'ns-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner creates a business');
select pg_temp.as_system();
update public.businesses set published_at = now() where slug = 'ns-alpha';
insert into public.business_members (business_id, user_id, role) select id, '00000000-0000-0000-0000-00000000b1a2', 'staff' from public.businesses where slug = 'ns-alpha';
create temp table ids as select (select id from public.businesses where slug = 'ns-alpha') as a, (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'ns-alpha') as s1;
grant select on ids to authenticated, service_role;


-- a customer with 3 no-shows (2 old ones outside the 60-day window do not count)
select pg_temp.as_system();
insert into public.customers (id, business_id, full_name, phone) values ('00000000-0000-0000-0000-0000000000c1', (select a from ids), 'חסר אחריות', '+972503330001');
create function pg_temp.mk_no_show(p_days_ago int) returns void language plpgsql as $$
begin
  insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, location, intake, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
  select b.id, (select id from public.resources where business_id = b.id and is_default), (select s1 from ids), '00000000-0000-0000-0000-0000000000c1', 'TR-' || upper(substr(md5(random()::text), 1, 6)), 'confirmed', 'business', '{}'::jsonb,
         now() - make_interval(days => p_days_ago), now() - make_interval(days => p_days_ago) + interval '30 minutes', now() - make_interval(days => p_days_ago) + interval '30 minutes',
         '{"name":"x","durationMinutes":30,"bufferMinutes":0,"priceCents":8000}'::jsonb, 8000, 'ILS' from public.businesses b where b.slug = 'ns-alpha';
  update public.appointments set status = 'no_show' where customer_id = '00000000-0000-0000-0000-0000000000c1' and status = 'confirmed' and starts_at < now();
end $$;
select pg_temp.mk_no_show(5); select pg_temp.mk_no_show(20); select pg_temp.mk_no_show(30); select pg_temp.mk_no_show(90); select pg_temp.mk_no_show(120);

-- policy off (default): nothing changes
select pg_temp.as_service();
select is(public.public_book((select a from ids), (select s1 from ids), now() + interval '3 days', 'חסר אחריות', '+972503330001', null, 'business', '{}', 'nskey-001', 'nh-1') ->> 'status', 'confirmed', 'policy off: booked and confirmed as usual');

-- require_approval
select pg_temp.as_system();
update public.businesses set no_show_policy = 'require_approval', no_show_threshold = 3 where slug = 'ns-alpha';
select pg_temp.as_service();
select is(public.public_book((select a from ids), (select s1 from ids), now() + interval '4 days', 'חסר אחריות', '+972503330001', null, 'business', '{}', 'nskey-002', 'nh-2') ->> 'status', 'pending', 'require_approval: 3 no-shows in 60 days ⇒ the booking waits for the owner');
select pg_temp.as_system();
update public.businesses set no_show_threshold = 4 where slug = 'ns-alpha';
select pg_temp.as_service();
select is(public.public_book((select a from ids), (select s1 from ids), now() + interval '5 days', 'חסר אחריות', '+972503330001', null, 'business', '{}', 'nskey-003', 'nh-3') ->> 'status', 'confirmed', 'a higher threshold than the recent count (the 2 old no-shows are outside the window) ⇒ confirmed');

-- block, with the business'' own text in the error detail
select pg_temp.as_system();
update public.businesses set no_show_policy = 'block', no_show_threshold = 3, block_message = 'נא ליצור קשר טלפונית' where slug = 'ns-alpha';
select pg_temp.as_service();
select throws_ok($$ select public.public_book((select a from ids), (select s1 from ids), now() + interval '6 days', 'חסר אחריות', '+972503330001', null, 'business', '{}', 'nskey-004', 'nh-4') $$, 'P0001', 'customer_blocked', 'block: refused');
select pg_temp.as_system();
select is((select count(*)::int from public.appointments where business_id = (select a from ids) and starts_at > now() + interval '5 days 12 hours'), 0, 'a refused booking creates nothing');
-- other customers are unaffected
select pg_temp.as_service();
select is(public.public_book((select a from ids), (select s1 from ids), now() + interval '6 days', 'לקוח אחר', '+972503330002', null, 'business', '{}', 'nskey-005', 'nh-5') ->> 'status', 'confirmed', 'another customer of the same business is unaffected');

-- override by an admin (audited); staff cannot
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a2');
select throws_ok($$ select public.set_customer_policy_override('00000000-0000-0000-0000-0000000000c1', true) $$, '42501', null, 'staff cannot clear a customer''s policy');
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select lives_ok($$ select public.set_customer_policy_override('00000000-0000-0000-0000-0000000000c1', true) $$, 'the owner clears it');
select pg_temp.as_service();
select is(public.public_book((select a from ids), (select s1 from ids), now() + interval '7 days', 'חסר אחריות', '+972503330001', null, 'business', '{}', 'nskey-006', 'nh-6') ->> 'status', 'confirmed', 'after the override the customer can book again');
select pg_temp.as_system();
select is((select count(*)::int from public.audit_log where action = 'customer.policy_override' and business_id = (select a from ids)), 1, 'the override is audited');

-- only admins configure the policy
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a2');
update public.businesses set no_show_policy = 'off' where slug = 'ns-alpha';
select pg_temp.as_system();
select is((select no_show_policy from public.businesses where slug = 'ns-alpha'), 'block', 'staff cannot change the policy (RLS filters the update)');
select pg_temp.as_system();
select throws_ok($$ update public.businesses set no_show_threshold = 0 where slug = 'ns-alpha' $$, '23514', null, 'threshold must be 1..20');
select is((select count(*)::int from private.lint_violations()), 0, 'schema lint stays empty');
select * from finish();
rollback;
