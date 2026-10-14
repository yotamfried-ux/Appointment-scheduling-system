-- pgTAP: findings of the independent security review — identity cannot be taken over by a phone number, grants enforce the invariants, audit gaps closed.
begin;
select * from no_plan();

delete from public.notification_log; delete from public.waitlist_offers; delete from public.waitlist_entries; delete from public.domain_events; delete from public.appointments;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000b1a1', 'authenticated', 'authenticated', 'i-owner@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000b1a2', 'authenticated', 'authenticated', 'i-staff@example.com', now(), '{}', '{}', now(), now());
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true); set local role service_role; end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'id-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner creates a business');
select pg_temp.as_system();
update public.businesses set published_at = now() where slug = 'id-alpha';
insert into public.business_members (business_id, user_id, role) select id, '00000000-0000-0000-0000-00000000b1a2', 'staff' from public.businesses where slug = 'id-alpha';
create temp table ids as select (select id from public.businesses where slug = 'id-alpha') as a, (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'id-alpha') as s1;
grant select on ids to authenticated, service_role;

-- ---------- 1. a phone number is not an identity (booking)
select pg_temp.as_service();
create temp table v as select (public.public_book((select a from ids), (select s1 from ids), now() + interval '3 days', 'דנה הקורבן', '+972501110001', 'victim@example.com', 'business', '{}', 'key-victim-1', 'h-v1') ->> 'id')::uuid as appt;
grant select on v to service_role, authenticated;
select lives_ok($$ select public.public_book((select a from ids), (select s1 from ids), now() + interval '4 days', 'תוקף', '+972501110001', 'attacker@example.com', 'business', '{}', 'key-attack-1', 'h-a1') $$, 'an attacker books with the victim''s phone and his own e-mail');
select pg_temp.as_system();
select is((select full_name || '|' || coalesce(email, '-') from public.customers where phone = '+972501110001'), 'דנה הקורבן|victim@example.com', 'the existing customer row is NOT rewritten (name and e-mail unchanged)');
select is((select contact_email from public.appointments where id = (select appt from v)), 'victim@example.com', 'the victim''s appointment keeps ITS address');
select is((select count(*)::int from public.appointments where contact_email = 'attacker@example.com'), 1, 'the attacker''s own appointment carries the attacker''s address (his own mail, nothing of the victim''s)');
select pg_temp.as_service();
create temp table n1 as select public.notif_enqueue((select appt from v), 'booking_confirmed', 'customer') as id;
grant select on n1 to service_role;
select is(public.notif_context((select id from n1)) -> 'customer' ->> 'email', 'victim@example.com', 'the victim''s notification goes to the victim, whatever the customer row says now');
select pg_temp.as_system();
update public.customers set email = 'tampered@example.com' where phone = '+972501110001';
select pg_temp.as_service();
select is(public.notif_context((select id from n1)) -> 'customer' ->> 'email', 'victim@example.com', '...even if the customer row is changed afterwards: mail follows the appointment');
select pg_temp.as_system();
-- a customer who gave no address cannot be given one by a stranger
insert into public.customers (business_id, full_name, phone) values ((select a from ids), 'ללא מייל', '+972501110002');
select pg_temp.as_service();
select lives_ok($$ select public.public_book((select a from ids), (select s1 from ids), now() + interval '5 days', 'מתחזה', '+972501110002', 'fill@example.com', 'business', '{}', 'key-attack-2', 'h-a2') $$, 'a stranger books with the phone of a customer who has no e-mail');
select pg_temp.as_system();
select is((select coalesce(email, 'none') from public.customers where phone = '+972501110002'), 'none', 'the e-mail-less customer did not gain an address from a stranger');

-- ---------- 2. waitlist: no address takeover, no link for strangers
select pg_temp.as_service();
create temp table w1 as select public.waitlist_join((select a from ids), (select s1 from ids), (now() at time zone 'Asia/Jerusalem')::date + 2, null, null, 'ממתינה', '+972501110003', 'wait-victim@example.com', 'idem-hash-original') as r;
grant select on w1 to service_role;
select is((select r ->> 'owner' from w1), 'true', 'the creator is recognised as the owner of the entry');
create temp table w2 as select public.waitlist_join((select a from ids), (select s1 from ids), (now() at time zone 'Asia/Jerusalem')::date + 2, null, null, 'תוקף', '+972501110003', 'wait-attacker@example.com', 'idem-hash-attacker') as r;
create temp table w3 as select public.waitlist_join((select a from ids), (select s1 from ids), (now() at time zone 'Asia/Jerusalem')::date + 2, null, null, 'ממתינה', '+972501110003', 'wait-victim@example.com', 'idem-hash-original') as r;
create temp table w4 as select public.waitlist_join((select a from ids), (select s1 from ids), (now() at time zone 'Asia/Jerusalem')::date + 2, null, null, 'ללא הוכחה', '+972501110003', 'x@example.com', null) as r;
grant select on w2, w3, w4 to service_role;
select is((select r ->> 'replay' from w2), 'true', 'a second join for the same phone/service/day is a replay');
select is((select r ->> 'owner' from w2), 'false', 'a stranger gets NO ownership of the existing entry (so no manage link)');
select is((select r ->> 'owner' from w3), 'true', 'the original caller (same idempotency proof) still gets it back on a retry');
select is((select r ->> 'owner' from w4), 'false', 'a caller with no proof gets nothing');
select pg_temp.as_system();
select is((select contact_email from public.waitlist_entries where customer_id = (select id from public.customers where phone = '+972501110003')), 'wait-victim@example.com', 'the entry keeps the victim''s address; the attacker''s join changed nothing');
select is((select email from public.customers where phone = '+972501110003'), 'wait-victim@example.com', 'the customer row was created by the first join and not rewritten by the second');

-- ---------- 3. erasure also removes the per-appointment addresses
reset role;  -- fixture edits as the table owner (service_role may no longer write these tables directly)
update public.appointments set status = 'cancelled_by_customer' where contact_email is not null and customer_id = (select id from public.customers where phone = '+972501110001');
delete from public.waitlist_entries where customer_id = (select id from public.customers where phone = '+972501110001');
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select is((public.anonymize_customer((select id from public.customers where phone = '+972501110001')) ->> 'outcome'), 'anonymized', 'the manager erases the customer');
select pg_temp.as_system();
select is((select count(*)::int from public.appointments where customer_id = (select id from public.customers where full_name = 'לקוח שנמחק' and business_id = (select a from ids)) and contact_email is not null), 0, 'no appointment of an erased customer keeps an address');

-- ---------- 4. the bulk export function is for managers whose plan includes the export
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a2');
select is((select count(*)::int from public.owner_customers_page((select a from ids), null, 100)), 0, 'staff cannot page through the export function');
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select ok((select count(*)::int from public.owner_customers_page((select a from ids), null, 100)) > 0, 'a manager on a plan with the export can');
select pg_temp.as_system();
update public.subscriptions set plan_id = 'starter', status = 'active', trial_ends_at = null where business_id = (select a from ids);
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select is((select count(*)::int from public.owner_customers_page((select a from ids), null, 100)), 0, '...and not on a plan without it (enforced in the database, not only in the route)');
select pg_temp.as_system();

-- ---------- 5. invariants by grants
select pg_temp.as_service();
select throws_ok($$ update public.subscriptions set status = 'active' $$, '42501', null, 'the system key cannot set a subscription by hand: only billing_apply_event does');
select throws_ok($$ insert into public.entitlement_overrides (business_id, key, bool_value, reason, created_by) values ((select a from ids), 'export', true, 'ניסיון עקיפה', '00000000-0000-0000-0000-00000000b1a1') $$, '42501', null, '...nor an override');
select throws_ok($$ delete from public.billing_events $$, '42501', null, '...nor erase billing history');
select throws_ok($$ delete from public.audit_log $$, '42501', null, '...nor the audit log');
select throws_ok($$ insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-00000000b1a1') $$, '42501', null, '...nor appoint a platform admin');
select pg_temp.as_system();
select throws_ok($$ truncate public.audit_log $$, '42501', 'audit_log is append-only', 'even the table owner cannot TRUNCATE the audit log');

-- ---------- 6. audit gaps
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a2');
select lives_ok($$ select public.set_customer_notes((select id from public.customers where phone = '+972501110002'), 'הערה סודית') $$, 'staff set notes');
select pg_temp.as_system();
select is((select count(*)::int from public.audit_log where action = 'customer.notes' and meta ->> 'length' = '10'), 1, 'changing notes is audited (that it changed, never what it says)');
select is((select count(*)::int from public.audit_log where meta::text like '%הערה סודית%'), 0, '...and the note text is not in the audit log');
select pg_temp.as_service();
select is(public.billing_apply_event('manual', 'ev-reason-1', 'subscription.updated', now(), (select a from ids), '{"planId":"pro","status":"active","reason":"שולם בהעברה בנקאית"}') ->> 'outcome', 'applied', 'an event with a reason is applied');
select pg_temp.as_system();
select is((select meta ->> 'reason' from public.audit_log where action = 'billing.subscription.updated' order by id desc limit 1), 'שולם בהעברה בנקאית', 'the reason is part of the audit row');
select pg_temp.as_service();
select throws_ok($$ select public.billing_apply_event('fake', 'ev-future', 'payment.failed', now() + interval '30 days', (select a from ids), '{}') $$, '23514', null, 'an event dated in the far future is refused (it would make every real event look stale)');
select pg_temp.as_system();

-- ---------- 7. entitlement edge case
insert into public.entitlement_overrides (business_id, key, bool_value, unlimited, reason, created_by) values ((select a from ids), 'max_services', true, false, 'בוליאני על מפתח מספרי', '00000000-0000-0000-0000-00000000b1a1');
select is(private.entitlement_limit((select a from ids), 'max_services'), 0, 'an override that sets no number is a closed door, not unlimited');
delete from public.entitlement_overrides;

-- ---------- 8. outbox lease and backoff
insert into public.domain_events (business_id, type, payload) values ((select a from ids), 'Probe', '{}');
select pg_temp.as_service();
select is((select count(*)::int from public.outbox_claim(10) where type = 'Probe'), 1, 'a worker claims the event');
select is((select count(*)::int from public.outbox_claim(10) where type = 'Probe'), 0, 'a second worker does not get it while the first holds the 5-minute lease');
select pg_temp.as_system();
select ok((select available_at > now() + interval '4 minutes' from public.domain_events where type = 'Probe'), 'the lease is about five minutes');
select pg_temp.as_service();
select lives_ok($$ select public.outbox_fail((select id from public.domain_events where type = 'Probe'), 'boom') $$, 'the worker reports a failure');
select pg_temp.as_system();
select ok((select available_at < now() + interval '10 seconds' and last_error = 'boom' from public.domain_events where type = 'Probe'), 'a failure sets a short retry backoff (the lease is released)');
update public.domain_events set attempts = 15, available_at = now() where type = 'Probe';
select pg_temp.as_service();
select is((select count(*)::int from public.outbox_claim(10) where type = 'Probe'), 0, 'an event that failed 15 times is no longer retried (it stays visible for people)');
select pg_temp.as_system();

-- ---------- 9. the new lint rule
create function private.zz_probe() returns int language sql security definer set search_path = '' as $$ select 1 $$;
select ok(exists (select 1 from private.lint_violations() where rule = 'private_definer_public_execute' and object_name = 'private.zz_probe'), 'negative control: a SECURITY DEFINER function left executable by PUBLIC is reported');
revoke execute on function private.zz_probe() from public;
select ok(not exists (select 1 from private.lint_violations() where object_name = 'private.zz_probe'), '...and is clean once the grant is revoked');
select is((select count(*)::int from private.lint_violations()), 0, 'the schema lint is clean');

select * from finish();
rollback;
