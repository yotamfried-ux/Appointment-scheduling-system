-- pgTAP: subscriptions + entitlements (BIL-01..06, 08, 09), webhook-event semantics (BIL-03), enforcement in the database, privileges (SEC-01/10).
begin;
select * from no_plan();

delete from public.notification_log;
delete from public.waitlist_offers;
delete from public.waitlist_entries;
delete from public.domain_events;
delete from public.appointments;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000008a1', 'authenticated', 'authenticated', 'b-owner@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000008b1', 'authenticated', 'authenticated', 'b-other@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000008c1', 'authenticated', 'authenticated', 'b-admin@example.com', now(), '{}', '{}', now(), now());

create function pg_temp.as_user(p_uid uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
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

select pg_temp.as_user('00000000-0000-0000-0000-0000000008a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'bl-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80},{"name":"צבע","durationMinutes":60,"priceNis":200}]',
  '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner A creates a business');
select pg_temp.as_user('00000000-0000-0000-0000-0000000008b1');
select lives_ok($$ select public.create_business('מספרה ב', 'barber', null, 'bl-beta', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]',
  '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner B creates a business');
select pg_temp.as_system();
create temp table ids as select
  (select id from public.businesses where slug = 'bl-alpha') as a, (select id from public.businesses where slug = 'bl-beta') as b,
  (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'bl-alpha' and s.name = 'תספורת') as s1;
grant select on ids to authenticated, anon, service_role;
update public.businesses set published_at = now() where id in ((select a from ids), (select b from ids));
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000008c1');

-- ---------- every business starts with a trial of the full plan (BIL-01)
select is(private.subscription_state((select a from ids)), 'trial', 'a new business is in trial');
select is((select status || '/' || plan_id from public.subscriptions where business_id = (select a from ids)), 'trialing/pro', 'the trial is on the full plan');
select ok((select trial_ends_at between now() + interval '13 days' and now() + interval '15 days' from public.subscriptions where business_id = (select a from ids)), 'the trial lasts about 14 days');
select ok(private.entitlement_can((select a from ids), 'waitlist') and private.entitlement_can((select a from ids), 'export'), 'trial includes every feature');
select ok(private.entitlement_limit((select a from ids), 'max_services') is null, 'trial has no service limit');
select ok(private.billing_accepts((select a from ids)), 'a trial accepts bookings');

create function pg_temp.mk(p_biz uuid, p_status text, p_starts timestamptz) returns uuid language plpgsql as $$
declare v_id uuid; v_cust uuid;
begin
  insert into public.customers (business_id, full_name, phone) values (p_biz, 'לקוח ' || substr(md5(random()::text), 1, 4), '+9725' || lpad((random() * 99999999)::int::text, 8, '0')) returning id into v_cust;
  insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, starts_at, ends_at, blocked_until, service_snapshot, price_cents)
  values (p_biz, (select id from public.resources where business_id = p_biz and is_default), (select id from public.services where business_id = p_biz order by position limit 1), v_cust,
          'BL-' || upper(substr(md5(random()::text), 1, 8)), p_status, p_starts, p_starts + interval '30 minutes', p_starts + interval '30 minutes',
          '{"name":"x","durationMinutes":30,"bufferMinutes":0,"priceCents":8000}', 8000) returning id into v_id;
  return v_id;
end $$;

select lives_ok($$ select pg_temp.mk((select a from ids), 'confirmed', now() + interval '2 days') $$, 'a trial business can take an appointment');
create temp table appt as select pg_temp.mk((select a from ids), 'confirmed', now() + interval '3 days') as id;
grant select on appt to authenticated;

-- ---------- BIL-01: the trial ends -> degraded; existing appointments keep working, new ones are refused
update public.subscriptions set trial_ends_at = now() - interval '1 minute' where business_id = (select a from ids);
select is(private.subscription_state((select a from ids)), 'degraded', 'an expired trial is degraded');
select ok(not private.billing_accepts((select a from ids)), 'degraded does not accept bookings');
select ok(not private.entitlement_can((select a from ids), 'waitlist'), 'degraded loses features');
select throws_ok($$ select pg_temp.mk((select a from ids), 'confirmed', now() + interval '4 days') $$, 'P0001', 'billing_inactive', 'a new appointment is refused, whatever the source');
select is((select count(*)::int from public.appointments where business_id = (select a from ids)), 2, 'nothing was deleted');
select pg_temp.as_user('00000000-0000-0000-0000-0000000008a1');
select lives_ok($$ select public.transition_appointment((select id from appt), 'cancel') $$, 'the owner can still manage existing appointments while degraded');
select pg_temp.as_system();
select is(private.public_catalog('bl-alpha') -> 'business' ->> 'acceptingBookings', 'false', 'the public catalogue says the business is not accepting');
select is(private.public_catalog('bl-beta') -> 'business' ->> 'acceptingBookings', 'true', '...and still accepts for a business in trial');
select is(private.public_catalog('bl-alpha') -> 'business' ->> 'waitlistEnabled', 'false', 'the waitlist is not offered without the feature');

-- ---------- events (BIL-03/04): only they change the state
select pg_temp.as_service();
select is(public.billing_apply_event('fake', 'ev-1', 'subscription.updated', '2026-06-01 10:00+00', (select a from ids),
  '{"planId":"starter","status":"active","currentPeriodEnd":"2099-01-01T00:00:00Z","externalCustomerId":"cus_1","externalSubscriptionId":"sub_1"}') ->> 'outcome', 'applied', 'an event is applied');
select pg_temp.as_system();
select is(private.subscription_state((select a from ids)), 'active', 'now active');
select is((select plan_id || '/' || external_customer_id || '/' || provider from public.subscriptions where business_id = (select a from ids)), 'starter/cus_1/fake', 'plan and provider identifiers are stored per provider');
select ok(private.billing_accepts((select a from ids)), 'an active subscription accepts bookings');
select ok(not private.entitlement_can((select a from ids), 'waitlist'), 'starter has no waitlist (BIL-08)');
select is(private.entitlement_limit((select a from ids), 'max_services'), 5, 'starter allows five services');

select pg_temp.as_service();
select is(public.billing_apply_event('fake', 'ev-1', 'payment.failed', '2026-06-02 10:00+00', (select a from ids), '{}') ->> 'outcome', 'duplicate', 'the same event id twice does nothing');
select is(public.billing_apply_event('fake', 'ev-0', 'payment.failed', '2026-05-01 10:00+00', (select a from ids), '{}') ->> 'outcome', 'stale', 'an older event never overrides a newer one');
select pg_temp.as_system();
select is((select status from public.subscriptions where business_id = (select a from ids)), 'active', 'the status is unchanged by duplicate and stale events');
select is((select count(*)::int from public.billing_events where business_id = (select a from ids)), 2, 'the first and the stale event are on record; the duplicate is not recorded twice');
select is((select outcome from public.billing_events where event_id = 'ev-0'), 'stale', '...with their outcome');
select pg_temp.as_service();
select is(public.billing_apply_event('fake', 'ev-x', 'payment.failed', now(), (select b from ids) , '{}') ->> 'outcome', 'applied', 'another business is independent');
select is(public.billing_apply_event('fake', 'ev-y', 'payment.failed', now(), '00000000-0000-0000-0000-00000000dead', '{}') ->> 'outcome', 'unknown_business', 'an unknown business is recorded, not an error');
select throws_ok($$ select public.billing_apply_event('fake', 'ev-z', 'refund.made', now(), (select a from ids), '{}') $$, '23514', null, 'an unknown event type is refused');
select is(public.billing_apply_event('fake', 'ev-p', 'subscription.updated', '2026-06-03 10:00+00', (select a from ids), '{"planId":"ghost"}') ->> 'outcome', 'invalid_plan', 'an unknown plan is ignored, not trusted');
select pg_temp.as_system();
select is((select plan_id from public.subscriptions where business_id = (select a from ids)), 'starter', 'the plan stays starter');

-- ---------- BIL-02: payment failure -> grace -> degraded
select pg_temp.as_service();
select public.billing_apply_event('fake', 'ev-f1', 'payment.failed', '2026-06-10 10:00+00', (select a from ids), '{}');
select pg_temp.as_system();
select is((select grace_until from public.subscriptions where business_id = (select a from ids)), '2026-06-17 10:00+00'::timestamptz, 'grace runs 7 days from the first failure');
update public.subscriptions set grace_until = now() + interval '3 days' where business_id = (select a from ids);
select is(private.subscription_state((select a from ids)), 'grace', 'inside grace the business keeps working');
select ok(private.billing_accepts((select a from ids)), 'bookings continue during grace');
select pg_temp.as_service();
select public.billing_apply_event('fake', 'ev-f2', 'payment.failed', now() + interval '1 hour', (select a from ids), '{}');
select pg_temp.as_system();
select ok((select grace_until < now() + interval '4 days' from public.subscriptions where business_id = (select a from ids)), 'a second failure does not extend the grace period');
update public.subscriptions set grace_until = now() - interval '1 minute' where business_id = (select a from ids);
select is(private.subscription_state((select a from ids)), 'degraded', 'after grace: degraded');
select pg_temp.as_service();
select public.billing_apply_event('fake', 'ev-ok', 'payment.succeeded', now() + interval '2 hours', (select a from ids), '{}');
select pg_temp.as_system();
select is(private.subscription_state((select a from ids)), 'active', 'a payment recovers the subscription');
select ok((select grace_until is null from public.subscriptions where business_id = (select a from ids)), '...and clears the grace clock');

-- ---------- BIL-06: cancel = active until the end of the paid period
select pg_temp.as_service();
select public.billing_apply_event('fake', 'ev-c', 'subscription.canceled', now() + interval '3 hours', (select a from ids), jsonb_build_object('currentPeriodEnd', now() + interval '10 days'));
select pg_temp.as_system();
select is(private.subscription_state((select a from ids)), 'active', 'cancelled but paid until the period end');
select ok((select cancel_at_period_end from public.subscriptions where business_id = (select a from ids)), 'the cancellation is flagged');
update public.subscriptions set current_period_end = now() - interval '1 second' where business_id = (select a from ids);
select is(private.subscription_state((select a from ids)), 'degraded', 'after the period ends: degraded');
update public.subscriptions set status = 'active', current_period_end = now() + interval '30 days', cancel_at_period_end = false where business_id = (select a from ids);

-- ---------- BIL-05: limits never delete, they only stop adding
insert into public.services (business_id, name, duration_minutes, price_cents, position)
  select (select a from ids), 'שירות ' || g, 30, 5000, 10 + g from generate_series(1, 3) g;                                  -- 2 + 3 = 5, exactly at the limit
select is((select count(*)::int from public.services where business_id = (select a from ids) and active), 5, 'five active services fit the starter plan');
select throws_ok($$ insert into public.services (business_id, name, duration_minutes, price_cents, position) values ((select a from ids), 'עוד אחד', 30, 5000, 99) $$, 'P0001', 'plan_limit', 'the sixth service is refused');
select lives_ok($$ insert into public.services (business_id, name, duration_minutes, price_cents, position, active) values ((select a from ids), 'לא פעיל', 30, 5000, 99, false) $$, 'an inactive service does not count');
select throws_ok($$ update public.services set active = true where business_id = (select a from ids) and name = 'לא פעיל' $$, 'P0001', 'plan_limit', 'reactivating beyond the limit is refused too');
select lives_ok($$ update public.services set price_cents = 6000 where business_id = (select a from ids) and name = 'שירות 1' $$, 'editing an existing service is always fine');
-- upgrade to pro, add many; then downgrade below usage: nothing is removed, adding is blocked
select pg_temp.as_service();
select public.billing_apply_event('fake', 'ev-pro', 'subscription.updated', now() + interval '4 hours', (select a from ids), '{"planId":"pro","status":"active"}');
select pg_temp.as_system();
select lives_ok($$ insert into public.services (business_id, name, duration_minutes, price_cents, position) select (select a from ids), 'פרו ' || g, 30, 5000, 200 + g from generate_series(1, 4) g $$, 'pro has no limit');
select pg_temp.as_service();
select public.billing_apply_event('fake', 'ev-down', 'subscription.updated', now() + interval '5 hours', (select a from ids), '{"planId":"starter"}');
select pg_temp.as_system();
select is((select count(*)::int from public.services where business_id = (select a from ids) and active), 9, 'after the downgrade all nine services are still there (over quota)');
select throws_ok($$ insert into public.services (business_id, name, duration_minutes, price_cents, position) values ((select a from ids), 'חריג', 30, 5000, 300) $$, 'P0001', 'plan_limit', '...and adding is blocked');

-- ---------- BIL-08: the waitlist feature is enforced in the database
create temp table w as select (select id from public.customers where business_id = (select a from ids) limit 1) as cust;
select throws_ok($$ insert into public.waitlist_entries (business_id, service_id, customer_id, on_date) values ((select a from ids), (select s1 from ids), (select cust from w), current_date + 1) $$, 'P0001', 'plan_required', 'a waitlist entry needs the feature');

-- ---------- BIL-09: overrides (platform admin + MFA, reason required, expiry, audit)
select pg_temp.as_user('00000000-0000-0000-0000-0000000008a1', 'aal2');
select throws_ok($$ select public.admin_set_override((select a from ids), 'waitlist', true, null, false, 'כי ביקשו מאיתנו', null) $$, '42501', null, 'a business owner cannot grant themselves entitlements');
select pg_temp.as_user('00000000-0000-0000-0000-0000000008c1', 'aal1');
select throws_ok($$ select public.admin_set_override((select a from ids), 'waitlist', true, null, false, 'כי ביקשו מאיתנו', null) $$, '42501', null, 'a platform admin needs MFA (aal2)');
select pg_temp.as_user('00000000-0000-0000-0000-0000000008c1', 'aal2');
select throws_ok($$ select public.admin_set_override((select a from ids), 'waitlist', true, null, false, 'קצר', null) $$, '23514', null, 'a reason of real length is required');
select throws_ok($$ select public.admin_set_override((select a from ids), 'waitlist', true, null, false, 'ארכה לפי בקשת הלקוח', now() - interval '1 day') $$, '23514', null, 'an override that is already over is refused');
select lives_ok($$ select public.admin_set_override((select a from ids), 'waitlist', true, null, false, 'ארכה לפי בקשת הלקוח', now() + interval '30 days') $$, 'a platform admin with MFA can grant a time-limited override');
select pg_temp.as_system();
select ok(private.entitlement_can((select a from ids), 'waitlist'), 'the override grants the feature even on starter');
select lives_ok($$ insert into public.waitlist_entries (business_id, service_id, customer_id, on_date) values ((select a from ids), (select s1 from ids), (select cust from w), current_date + 1) $$, '...and the database accepts the entry');
select is((select count(*)::int from public.audit_log where business_id = (select a from ids) and action = 'billing.override_set'), 1, 'the override is in the audit log, visible to the business');
update public.entitlement_overrides set expires_at = now() - interval '1 second' where business_id = (select a from ids);
select ok(not private.entitlement_can((select a from ids), 'waitlist'), 'an expired override no longer counts');
select pg_temp.as_user('00000000-0000-0000-0000-0000000008c1', 'aal2');
select lives_ok($$ select public.admin_set_override((select a from ids), 'max_services', null, null, true, 'ללא הגבלה בהסכם מיוחד', null) $$, 'an unlimited override');
select pg_temp.as_system();
select ok(private.entitlement_limit((select a from ids), 'max_services') is null, 'unlimited means no limit');
select pg_temp.as_user('00000000-0000-0000-0000-0000000008c1', 'aal2');
select lives_ok($$ select public.admin_remove_override((select a from ids), 'max_services') $$, 'an override can be removed');
select is((select (public.admin_manual_subscription((select a from ids), 'pro', 'active', now() + interval '30 days', 'שולם בהעברה בנקאית') ->> 'outcome')), 'applied', 'the manual provider records an agreed subscription through the same event path');
select pg_temp.as_system();
select is((select provider || '/' || plan_id from public.subscriptions where business_id = (select a from ids)), 'manual/pro', '...as provider "manual"');

-- ---------- privileges and isolation (SEC-01)
select pg_temp.as_user('00000000-0000-0000-0000-0000000008a1');
select is((select count(*)::int from public.subscriptions), 1, 'an owner sees only their own subscription');
select is((select public.my_billing((select a from ids)) ->> 'state'), 'active', 'my_billing reports the state');
select ok((select public.my_billing((select b from ids))) is null, 'my_billing of someone else is empty');
select throws_ok($$ update public.subscriptions set plan_id = 'pro', status = 'active' where business_id = (select a from ids) $$, '42501', null, 'an owner cannot edit their own subscription');
select throws_ok($$ insert into public.entitlement_overrides (business_id, key, bool_value, reason, created_by) values ((select a from ids), 'export', true, 'ניסיון עקיפה', '00000000-0000-0000-0000-0000000008a1') $$, '42501', null, 'an owner cannot write overrides');
select throws_ok($$ select * from public.billing_events $$, '42501', null, 'billing events are internal');
select throws_ok($$ select external_customer_id from public.subscriptions $$, '42501', null, 'provider identifiers are never readable by owners');
select throws_ok($$ select public.billing_apply_event('fake', 'ev-hack', 'payment.succeeded', now(), (select a from ids), '{}') $$, '42501', null, 'an owner cannot send billing events');
select ok((select count(*) from public.plans) >= 2, 'plans are readable');
select pg_temp.as_anon();
select throws_ok($$ select * from public.plans $$, '42501', null, 'anonymous callers cannot read plans');
select throws_ok($$ select public.my_billing((select a from ids)) $$, '42501', null, 'anonymous callers cannot call my_billing');
select pg_temp.as_system();

select * from finish();
rollback;
