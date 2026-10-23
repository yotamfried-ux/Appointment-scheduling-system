-- pgTAP: a customer is identified by e-mail, never by the phone number typed on a public form (Strix VULN-0008 / 0013 / 0016 / 0004).
begin;
select * from no_plan();

delete from public.notification_log; delete from public.waitlist_offers; delete from public.waitlist_entries; delete from public.domain_events; delete from public.appointments;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000e1a1', 'authenticated', 'authenticated', 'e-owner@example.com', now(), '{}', '{}', now(), now());
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true); set local role service_role; end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000e1a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'em-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner creates a business');
select pg_temp.as_system();
update public.businesses set published_at = now() where slug = 'em-alpha';
create temp table ids as select (select id from public.businesses where slug = 'em-alpha') as a, (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'em-alpha') as s1;
grant select on ids to authenticated, service_role;

-- ---------- the mailbox key (same rules as lib/mailbox.ts)
select is(private.mailbox_key('  Dana.Levi+Promo@Gmail.COM '), 'danalevi@gmail.com', 'case, +tag and Gmail dots are one mailbox');
select is(private.mailbox_key('a.b@googlemail.com'), 'ab@gmail.com', 'googlemail is gmail');
select is(private.mailbox_key('a.b+x@example.com'), 'a.b@example.com', 'dots count outside Gmail, +tags do not');
select is(private.mailbox_key('not-an-address'), 'not-an-address', 'something that is not an address is kept as is');
select ok(private.mailbox_key('   ') is null and private.mailbox_key(null) is null, 'nothing, no key');

-- ---------- booking: an e-mail is required, and it is the identity
select pg_temp.as_service();
select throws_ok($$ select public.public_book((select a from ids), (select s1 from ids), now() + interval '3 days', 'דנה', '+972501110001', null, 'business', '{}', 'em-key-0001', 'eh-1') $$, '23514', null, 'a booking without an e-mail is refused');
select throws_ok($$ select public.public_book((select a from ids), (select s1 from ids), now() + interval '3 days', 'דנה', '+972501110001', '   ', 'business', '{}', 'em-key-0002', 'eh-2') $$, '23514', null, '...also a blank one');
create temp table b1 as select public.public_book((select a from ids), (select s1 from ids), now() + interval '3 days', 'דנה לוי', '+972501110001', 'Dana.Levi@gmail.com', 'business', '{}', 'em-key-0003', 'eh-3') as r;
create temp table b2 as select public.public_book((select a from ids), (select s1 from ids), now() + interval '4 days', 'מישהי אחרת', '+972501119999', 'danalevi+beauty@gmail.com', 'business', '{}', 'em-key-0004', 'eh-4') as r;
grant select on b1, b2 to service_role;
select pg_temp.as_system();
select is((select count(*)::int from public.customers where business_id = (select a from ids)), 1, 'the same mailbox written two ways is one customer');
select is((select full_name || '|' || phone from public.customers where business_id = (select a from ids)), 'דנה לוי|+972501110001', 'the record of the first booking is not rewritten by the second (name and phone stay)');
select is((select count(distinct customer_id)::int from public.appointments where business_id = (select a from ids)), 1, 'both appointments are on that customer');

-- a stranger who knows only the phone number gets a record of his own: the victim's limit and record are untouched
select pg_temp.as_service();
select lives_ok($$ select public.public_book((select a from ids), (select s1 from ids), now() + interval '5 days', 'תוקף', '+972501110001', 'attacker@example.com', 'business', '{}', 'em-key-0005', 'eh-5') $$, 'someone books with the victim''s phone and his own address');
select pg_temp.as_system();
select is((select count(*)::int from public.customers where business_id = (select a from ids) and phone = '+972501110001'), 2, 'the same phone, two records: the phone selects nobody');
select is((select count(*)::int from public.appointments a join public.customers c on c.id = a.customer_id where c.email = 'Dana.Levi@gmail.com'), 2, 'the victim''s record still has exactly its own two appointments');

-- the booking limit (BKG-07) is per mailbox: filling up one's own does not touch the victim
select pg_temp.as_service();
select lives_ok(format($$ select public.public_book((select a from ids), (select s1 from ids), now() + interval '%s days', 'תוקף', '+972501110001', 'attacker@example.com', 'business', '{}', 'em-fill-%s', 'ef-%s') $$, 10 + i, i, i), 'the attacker fills his own booking budget #' || i) from generate_series(1, 4) i;
select throws_ok($$ select public.public_book((select a from ids), (select s1 from ids), now() + interval '30 days', 'תוקף', '+972501110001', 'attacker@example.com', 'business', '{}', 'em-fill-9', 'ef-9') $$, 'P0001', 'booking_limit', 'his own budget ends at five');
select lives_ok($$ select public.public_book((select a from ids), (select s1 from ids), now() + interval '31 days', 'דנה לוי', '+972501110001', 'Dana.Levi@gmail.com', 'business', '{}', 'em-key-0006', 'eh-6') $$, 'the victim can still book');

-- ---------- the owner identifies a walk-in by the phone he typed (he is trusted; a walk-in may have no e-mail)
select pg_temp.as_user('00000000-0000-0000-0000-00000000e1a1');
select lives_ok($$ select public.create_manual_appointment((select a from ids), (select s1 from ids), now() + interval '40 days', 'לקוח טלפוני', '+972501112223', null, true) $$, 'the owner enters a walk-in');
select lives_ok($$ select public.create_manual_appointment((select a from ids), (select s1 from ids), now() + interval '41 days', 'לקוח טלפוני', '+972501112223', null, true) $$, '...and the same phone again');
select pg_temp.as_system();
select is((select count(*)::int from public.customers where business_id = (select a from ids) and phone = '+972501112223'), 1, 'the owner''s second entry reuses that record');

-- ---------- waitlist: same rule
select pg_temp.as_service();
create temp table w1 as select public.waitlist_join((select a from ids), (select s1 from ids), (now() at time zone 'Asia/Jerusalem')::date + 2, null, null, 'ממתינה', '+972501110003', 'wait.victim@gmail.com', 'idem-w-1') as r;
create temp table w2 as select public.waitlist_join((select a from ids), (select s1 from ids), (now() at time zone 'Asia/Jerusalem')::date + 2, null, null, 'תוקף', '+972501110003', 'wait-attacker@example.com', 'idem-w-2') as r;
grant select on w1, w2 to service_role;
select is((select r ->> 'replay' from w2), 'false', 'a join with the victim''s phone and another address is not a replay: it is its own entry');
select is((select r ->> 'owner' from w1), 'true', 'the creator still owns the victim''s entry');
select pg_temp.as_system();
select is((select count(*)::int from public.waitlist_entries where business_id = (select a from ids)), 2, 'two separate entries; the victim''s one and its address are untouched');
select is((select contact_email from public.waitlist_entries where id = (select (r ->> 'id')::uuid from w1)), 'wait.victim@gmail.com', 'the victim''s entry keeps its address');

-- ---------- erasure releases the mailbox
reset role;
update public.appointments set status = 'cancelled_by_customer' where customer_id in (select id from public.customers where email = 'wait-attacker@example.com' or email = 'attacker@example.com');
delete from public.waitlist_entries where customer_id in (select id from public.customers where email = 'wait-attacker@example.com');
select pg_temp.as_user('00000000-0000-0000-0000-00000000e1a1');
select is((public.anonymize_customer((select id from public.customers where email = 'wait-attacker@example.com')) ->> 'outcome'), 'anonymized', 'an erased customer');
select pg_temp.as_system();
select ok((select email is null and email_key is null from public.customers where full_name = 'לקוח שנמחק' and business_id = (select a from ids) limit 1), '...loses the address and its key, so the mailbox is free again');

select is((select count(*)::int from private.lint_violations()), 0, 'the schema lint is clean');
select * from finish();
rollback;
