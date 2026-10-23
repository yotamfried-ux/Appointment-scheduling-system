-- pgTAP: waitlist (WLT-01..06, 08), offers decided in SQL, EXCLUDE as the arbiter, privileges and tenant isolation.
begin;
select * from no_plan();

delete from public.notification_log;   -- these tests assume an empty outbox (rolled back at the end)
delete from public.waitlist_offers;
delete from public.waitlist_entries;
delete from public.domain_events;
delete from public.appointments;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000005a1', 'authenticated', 'authenticated', 'w-owner@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000005a3', 'authenticated', 'authenticated', 'w-staff@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000005b1', 'authenticated', 'authenticated', 'w-other@example.com', now(), '{}', '{}', now(), now());

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

select pg_temp.as_user('00000000-0000-0000-0000-0000000005a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'wl-alpha',
  '[{"name":"תספורת","durationMinutes":30,"priceNis":80},{"name":"צבע","durationMinutes":60,"priceNis":200}]',
  '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner A creates a business');
select pg_temp.as_user('00000000-0000-0000-0000-0000000005b1');
select lives_ok($$ select public.create_business('מספרה ב', 'barber', null, 'wl-beta', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]',
  '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner B creates a business');
select pg_temp.as_system();
update public.businesses set published_at = now();
insert into public.business_members (business_id, user_id, role) select id, '00000000-0000-0000-0000-0000000005a3', 'staff' from public.businesses where slug = 'wl-alpha';

create temp table ids as select
  (select id from public.businesses where slug = 'wl-alpha') as a,
  (select id from public.businesses where slug = 'wl-beta') as b,
  (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'wl-alpha' and s.name = 'תספורת') as s30,
  (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'wl-alpha' and s.name = 'צבע') as s60,
  (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'wl-beta') as sb,
  date_trunc('day', now()) + interval '10 days' as day;
update public.services set buffer_minutes = 0;
create temp table dates as select ((select day from ids) + interval '10 hours')::date as d1, ((select day from ids) + interval '10 hours' + interval '1 day')::date as d2;
grant select on ids, dates to authenticated, anon, service_role;

create function pg_temp.book(p_start timestamptz, p_phone text, p_key text, p_service uuid default null) returns jsonb language sql as $$
  select public.public_book((select a from ids), coalesce(p_service, (select s30 from ids)), p_start, 'לקוח ' || p_phone, p_phone, 'u' || regexp_replace(p_phone, '\D', '', 'g') || '@example.com', 'business', '{}', p_key, p_key)
$$;
create function pg_temp.join(p_phone text, p_date date default null, p_service uuid default null, p_from int default null, p_to int default null, p_email text default null) returns jsonb language sql as $$
  select public.waitlist_join((select a from ids), coalesce(p_service, (select s30 from ids)), coalesce(p_date, (select d1 from dates)), p_from, p_to, 'ממתין ' || p_phone, p_phone, coalesce(p_email, 'u' || regexp_replace(p_phone, '\D', '', 'g') || '@example.com'))
$$;

-- ---------- privileges ----------
select pg_temp.as_anon();
select throws_ok($$ select pg_temp.join('+972501000001') $$, '42501', null, 'anon cannot join through the system function');
select pg_temp.as_user('00000000-0000-0000-0000-0000000005a1');
select throws_ok($$ select public.waitlist_accept(gen_random_uuid()) $$, '42501', null, 'an owner cannot call the customer-side accept');
select throws_ok($$ select public.waitlist_sweep(now()) $$, '42501', null, 'nor the sweep');
select throws_ok($$ select public.waitlist_join((select a from ids), (select s30 from ids), (select d1 from dates), null, null, 'x', '+972501000001', 'a@b.co') $$, '42501', null, 'nor join');
select throws_ok($$ insert into public.waitlist_entries (business_id, service_id, customer_id, on_date) values ((select a from ids), (select s30 from ids), gen_random_uuid(), (select d1 from dates)) $$, '42501', null, 'owners cannot write the waitlist directly');
select pg_temp.as_system();

-- ---------- join (WLT-08) ----------
select pg_temp.as_service();
select is((pg_temp.join('+972501000001'))->>'replay', 'false', 'joining creates an entry');
select is((pg_temp.join('+972501000001'))->>'replay', 'true', 'WLT-08: joining twice for the same service and day is idempotent');
select is((select count(*)::int from public.waitlist_entries), 1, 'still one entry');
select throws_ok($$ select pg_temp.join('+972501000009', null, null, null, null, '') $$, '23514', 'email_required', 'an e-mail address is required: offers travel by e-mail');
select throws_ok($$ select pg_temp.join('+972501000009', (select d1 from dates) - 400) $$, 'P0001', 'date_out_of_range', 'a past date is refused');
select throws_ok($$ select pg_temp.join('+972501000009', (select d1 from dates) + 400) $$, 'P0001', 'date_out_of_range', 'a date beyond the booking horizon is refused');
select throws_ok($$ select public.waitlist_join((select a from ids), (select sb from ids), (select d1 from dates), null, null, 'x y', '+972501000009', 'a@b.co') $$, 'P0001', 'service_unavailable', 'a service of another business cannot be used');
select throws_ok($$ select pg_temp.join('+972501000009', (select d1 from dates), null, 600, 540) $$, '23514', null, 'an inverted time window is refused');
select lives_ok($$ select pg_temp.join('+972501000001', (select d2 from dates)) $$, 'a second day for the same customer');
select lives_ok($$ select pg_temp.join('+972501000001', (select d2 from dates), (select s60 from ids)) $$, 'a third entry');
select throws_ok($$ select pg_temp.join('+972501000001', (select d2 from dates) + 1) $$, 'P0001', 'waitlist_limit', 'WLT-08: at most 3 active entries per customer');
select is((select count(*)::int from public.customers where business_id = (select a from ids) and phone = '+972501000001'), 1, 'one customer row per phone (BKG-05)');
select pg_temp.as_system();
delete from public.waitlist_entries;

-- ---------- WLT-01: a cancellation offers the slot to the first in line ----------
select pg_temp.as_service();
create temp table appt as select (pg_temp.book((select day from ids) + interval '10 hours', '+972502000000', 'wl-key-0001')->>'id')::uuid as id;
grant select on appt to authenticated, service_role;
select pg_temp.join('+972501000001');   -- E1
select pg_temp.join('+972501000002');   -- E2
select pg_temp.join('+972501000003');   -- E3
select pg_temp.join('+972501000004', (select d2 from dates));                                   -- other day: never matches
select pg_temp.join('+972501000005', (select d1 from dates), (select s60 from ids));            -- needs 60 min: the freed hole is 30
select pg_temp.join('+972501000006', (select d1 from dates), null, 17 * 60, 19 * 60);          -- only wants the evening (local time): no morning/afternoon slot matches
select pg_temp.as_system();
update public.waitlist_entries set created_at = now() - interval '10 minutes' where customer_id = (select id from public.customers where business_id = (select a from ids) and phone = '+972501000001');
update public.waitlist_entries set created_at = now() - interval '9 minutes' where customer_id = (select id from public.customers where business_id = (select a from ids) and phone = '+972501000002');
update public.waitlist_entries set created_at = now() - interval '8 minutes' where customer_id = (select id from public.customers where business_id = (select a from ids) and phone = '+972501000003');
create temp table e as select
  (select id from public.waitlist_entries where customer_id = (select id from public.customers where business_id = (select a from ids) and phone = '+972501000001')) as e1,
  (select id from public.waitlist_entries where customer_id = (select id from public.customers where business_id = (select a from ids) and phone = '+972501000002')) as e2,
  (select id from public.waitlist_entries where customer_id = (select id from public.customers where business_id = (select a from ids) and phone = '+972501000003')) as e3,
  (select id from public.waitlist_entries where customer_id = (select id from public.customers where business_id = (select a from ids) and phone = '+972501000005')) as e_long;
grant select on e to authenticated, service_role;

select pg_temp.as_service();
select is((select public.public_cancel((select id from appt))->>'status'), 'cancelled_by_customer', 'the customer cancels the 10:00 appointment');
select is((select count(*)::int from public.waitlist_offers where status = 'pending'), 1, 'WLT-01: exactly one live offer for the freed slot');
select is((select entry_id from public.waitlist_offers where status = 'pending'), (select e1 from e), 'WLT-01: it goes to the first in line (FIFO)');
select is((select status from public.waitlist_entries where id = (select e1 from e)), 'offered', 'the entry is marked as offered');
select is((select status from public.waitlist_entries where id = (select e2 from e)), 'waiting', 'the next one keeps waiting');
select is((select status from public.waitlist_entries where id = (select e_long from e)), 'waiting', 'a service that does not fit the hole is not offered it');
select is((select count(*)::int from public.waitlist_offers where entry_id not in (select e1 from e)), 0, 'other-day and evening-only entries are not offered the morning slot');
select is((select count(*)::int from public.notification_log where type = 'waitlist_offer' and recipient = 'customer'), 1, 'the offer e-mail is queued in the same transaction');
select ok((select expires_at between now() + interval '29 minutes' and now() + interval '31 minutes' from public.waitlist_offers where status = 'pending'), 'the offer lasts 30 minutes by default');
select throws_ok($$ insert into public.waitlist_offers (business_id, entry_id, slot_starts_at, slot_ends_at, blocked_until, freed_until, expires_at)
  select a, (select e2 from e), (select day from ids) + interval '10 hours 10 minutes', (select day from ids) + interval '10 hours 40 minutes', (select day from ids) + interval '10 hours 40 minutes', (select day from ids) + interval '11 hours', now() + interval '1 hour' from ids $$,
  '23P01', null, 'two live offers can never cover the same stretch of time (EXCLUDE)');

-- ---------- WLT-04: the slot gets booked before the offer is accepted ----------
select ok((select count(*) from public.public_busy((select a from ids), (select day from ids) + interval '9 hours', (select day from ids) + interval '11 hours') where starts_at = (select day from ids) + interval '10 hours') >= 1, 'the offered slot is busy for the public (so it is not listed)');
select throws_ok($$ select pg_temp.book((select day from ids) + interval '10 hours', '+972502000001', 'wl-key-0002') $$, 'P0001', 'slot_taken', 'a live offer RESERVES its slot: the public path cannot take it meanwhile');
-- the owner can still book it by hand (WLT-04): simulate the owner's manual appointment
select pg_temp.as_system();
insert into public.customers (business_id, full_name, phone) select a, 'ידני', '+972502000001' from ids;
insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, source, starts_at, ends_at, blocked_until, service_snapshot, price_cents)
  select a, (select id from public.resources where business_id = a and is_default), (select s30 from ids), (select id from public.customers where phone = '+972502000001' and business_id = a), 'TR-HAND01', 'confirmed', 'manual',
         (select day from ids) + interval '10 hours', (select day from ids) + interval '10 hours 30 minutes', (select day from ids) + interval '10 hours 30 minutes', '{"name":"x","durationMinutes":30,"bufferMinutes":0,"priceCents":8000}'::jsonb, 8000 from ids;
select pg_temp.as_service();
select is((select public.waitlist_accept((select id from public.waitlist_offers where status = 'pending')))->>'outcome', 'slot_taken', 'WLT-04: accepting now says the slot is taken');
select is((select status from public.waitlist_entries where id = (select e1 from e)), 'waiting', 'WLT-04: the customer stays on the list');
select is((select status from public.waitlist_offers where entry_id = (select e1 from e)), 'lost', 'and the offer is marked lost');
select is((select count(*)::int from public.appointments where starts_at = (select day from ids) + interval '10 hours' and status in ('pending','confirmed')), 1, 'never two appointments in one slot');

-- ---------- WLT-01/02: accept creates the booking; a second accept does nothing ----------
select pg_temp.as_system();
delete from public.waitlist_offers;
delete from public.appointments where reference is not null and starts_at = (select day from ids) + interval '10 hours';   -- clear the table for the next scenario
update public.waitlist_entries set status = 'waiting';
select pg_temp.as_service();
create temp table appt2 as select (pg_temp.book((select day from ids) + interval '11 hours', '+972502000002', 'wl-key-0003')->>'id')::uuid as id;
grant select on appt2 to service_role;
select public.public_cancel((select id from appt2));
create temp table o1 as select id from public.waitlist_offers where status = 'pending' and slot_starts_at = (select day from ids) + interval '11 hours';
grant select on o1 to service_role;
select is((select entry_id from public.waitlist_offers where id = (select id from o1)), (select e1 from e), 'a new freed slot goes to the first in line again');
-- Strix 2026-10-22: accepting must respect the per-customer limit of 5 future appointments, like direct booking (BKG-07)
select pg_temp.as_system();
insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
select e.business_id, (select id from public.resources where business_id = e.business_id and is_default), e.service_id, e.customer_id, 'TR-LIM0' || g, 'confirmed',
       (select day from ids) + (20 + g) * interval '1 day' + interval '10 hours', (select day from ids) + (20 + g) * interval '1 day' + interval '10 hours 30 minutes', (select day from ids) + (20 + g) * interval '1 day' + interval '10 hours 30 minutes',
       '{"name":"x","durationMinutes":30,"bufferMinutes":0,"priceCents":8000}'::jsonb, 8000, 'ILS'
from public.waitlist_entries e, generate_series(1, 5) g where e.id = (select e1 from e);
select pg_temp.as_service();
select is((select public.waitlist_accept((select id from o1)))->>'outcome', 'limit', 'a customer already holding 5 future appointments cannot accept another through the waitlist');
select is((select status from public.waitlist_offers where id = (select id from o1)), 'pending', '...and the offer stays pending');
select pg_temp.as_system();
delete from public.appointments where reference like 'TR-LIM0%';
select pg_temp.as_service();
select is((select public.waitlist_accept((select id from o1)))->>'outcome', 'accepted', 'WLT-01: accepting books the slot');
select is((select status from public.appointments where starts_at = (select day from ids) + interval '11 hours' and status in ('pending','confirmed') limit 1), 'confirmed', 'the appointment is confirmed');
select is((select status from public.waitlist_entries where id = (select e1 from e)), 'booked', 'the entry is booked');
select is((select public.waitlist_accept((select id from o1)))->>'outcome', 'not_pending', 'WLT-02: accepting twice is a no-op');
select is((select count(*)::int from public.appointments where starts_at = (select day from ids) + interval '11 hours' and status in ('pending','confirmed')), 1, 'exactly one appointment');
select is((select count(*)::int from public.domain_events where type = 'AppointmentCreated' and payload->>'via' = 'waitlist'), 1, 'the booking queued its confirmation event');

-- ---------- WLT-03: expiry moves on to the next; the sweep is idempotent ----------
select pg_temp.as_system();
delete from public.waitlist_offers;
delete from public.appointments where starts_at = (select day from ids) + interval '11 hours';
update public.waitlist_entries set status = 'waiting';
delete from public.notification_log;
select pg_temp.as_service();
create temp table appt3 as select (pg_temp.book((select day from ids) + interval '12 hours', '+972502000003', 'wl-key-0004')->>'id')::uuid as id;
grant select on appt3 to service_role;
select public.public_cancel((select id from appt3));
select is((select entry_id from public.waitlist_offers where status = 'pending'), (select e1 from e), 'E1 holds the offer for 12:00');
select pg_temp.as_system();
update public.waitlist_offers set expires_at = now() - interval '1 minute' where status = 'pending';
select pg_temp.as_service();
select is((select public.waitlist_sweep(now()))->>'expired', '1', 'WLT-03: the sweep expires the unanswered offer');
select is((select status from public.waitlist_offers where entry_id = (select e1 from e)), 'expired', 'the original offer is expired');
select is((select entry_id from public.waitlist_offers where status = 'pending'), (select e2 from e), 'WLT-03: the slot moves on to the next in line');
select is((select status from public.waitlist_entries where id = (select e1 from e)), 'waiting', 'the first stays on the list (but is never offered this slot again)');
select is((select count(*)::int from public.notification_log where type = 'waitlist_offer_expired'), 1, 'WLT-03: the original recipient is told the offer expired');
select is((select public.waitlist_sweep(now()))->>'expired', '0', 'running the sweep again changes nothing (idempotent)');
select is((select count(*)::int from public.notification_log where type = 'waitlist_offer'), 2, 'no duplicate offer messages');

-- ---------- decline / leave pass the slot along ----------
select is((select public.waitlist_decline((select id from public.waitlist_offers where status = 'pending')))->>'outcome', 'declined', 'E2 declines');
select is((select entry_id from public.waitlist_offers where status = 'pending'), (select e3 from e), 'the slot goes to E3');
select is((select public.waitlist_leave((select e3 from e)))->>'outcome', 'left', 'E3 leaves the list altogether');
select is((select count(*)::int from public.waitlist_offers where status = 'pending'), 0, 'nobody left to offer to: no live offer');
select is((select status from public.waitlist_entries where id = (select e3 from e)), 'cancelled', 'E3 is off the list');
select is((select public.waitlist_leave((select e3 from e)))->>'outcome', 'not_active', 'leaving twice is harmless');
select is((select count(*)::int from public.waitlist_offers where entry_id = (select e1 from e) and slot_starts_at = (select day from ids) + interval '12 hours'), 1, 'WLT-03: the same slot is never offered to the same person twice');

-- ---------- WLT-06: auto-offer off; manual offer by staff ----------
select pg_temp.as_system();
delete from public.waitlist_offers;
update public.waitlist_entries set status = 'waiting' where status <> 'cancelled';
update public.businesses set waitlist_auto_offer = false where id = (select a from ids);
select pg_temp.as_service();
create temp table appt4 as select (pg_temp.book((select day from ids) + interval '13 hours', '+972502000004', 'wl-key-0005')->>'id')::uuid as id;
grant select on appt4 to service_role;
select public.public_cancel((select id from appt4));
select is((select count(*)::int from public.waitlist_offers), 0, 'WLT-06: with auto-offer off a freed slot is not offered by itself');
select pg_temp.as_user('00000000-0000-0000-0000-0000000005a3');
select lives_ok($$ select public.waitlist_manual_offer((select e2 from e), (select day from ids) + interval '13 hours') $$, 'WLT-06: staff offer the slot to a chosen entry');
select is((select status from public.waitlist_entries where id = (select e2 from e)), 'offered', 'that entry is offered');
select throws_ok($$ select public.waitlist_manual_offer((select e2 from e), (select day from ids) + interval '14 hours') $$, 'P0001', 'invalid_state', 'an entry that already holds an offer cannot be offered another');
select throws_ok($$ select public.waitlist_manual_offer((select e_long from e), (select day from ids) + interval '13 hours') $$, 'P0001', 'slot_unavailable', 'a slot that is already reserved by a live offer is unavailable');
select pg_temp.as_user('00000000-0000-0000-0000-0000000005b1');
select throws_ok($$ select public.waitlist_manual_offer((select e1 from e), (select day from ids) + interval '15 hours') $$, '42501', 'forbidden', 'SEC-01: another business cannot offer for these entries');
select throws_ok($$ select public.waitlist_owner_remove((select e1 from e)) $$, '42501', 'forbidden', 'nor remove them');
select pg_temp.as_user('00000000-0000-0000-0000-0000000005a1');
select is((select public.waitlist_owner_remove((select e2 from e)))->>'outcome', 'left', 'the owner removes an entry (its live offer is withdrawn)');
select is((select count(*)::int from public.waitlist_offers where status = 'pending'), 0, 'and no live offer remains');
select ok((select count(*) from public.audit_log where action in ('waitlist.manual_offer', 'waitlist.remove') and business_id = (select a from ids)) = 2, 'manual offers and removals are audited');
select pg_temp.as_system();
update public.businesses set waitlist_auto_offer = true where id = (select a from ids);

-- ---------- owner cancellation / rejection also frees the slot ----------
select pg_temp.as_system();
update public.waitlist_entries set status = 'waiting' where status in ('cancelled', 'offered') and id in (select e1 from e union select e2 from e);
select pg_temp.as_service();
create temp table appt5 as select (pg_temp.book((select day from ids) + interval '15 hours', '+972502000005', 'wl-key-0006')->>'id')::uuid as id;
grant select on appt5 to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000005a1');
select lives_ok($$ select public.transition_appointment((select id from appt5), 'cancel') $$, 'the owner cancels an appointment');
select is((select count(*)::int from public.waitlist_offers where status = 'pending' and slot_starts_at = (select day from ids) + interval '15 hours'), 1, 'the freed slot is offered to the waiting list');
select pg_temp.as_system();

-- ---------- too close to the start: no offer ----------
alter table public.waitlist_entries disable trigger waitlist_entries_guard;   -- fixture only: the guard is tested below
update public.businesses set min_notice_minutes = 0 where id = (select a from ids);
delete from public.waitlist_offers;
update public.waitlist_entries set status = 'waiting', on_date = ((now() + interval '40 minutes') at time zone 'Asia/Jerusalem')::date where id = (select e1 from e);
select pg_temp.as_service();
select is((select private.waitlist_offer_for_slot((select a from ids), now() + interval '5 minutes', now() + interval '65 minutes')), null, 'a slot starting in 5 minutes is not offered (not enough time to react)');
select isnt((select private.waitlist_offer_for_slot((select a from ids), now() + interval '40 minutes', now() + interval '100 minutes')), null, 'a slot starting in 40 minutes is offered');
select ok((select expires_at <= slot_starts_at - interval '10 minutes' from public.waitlist_offers where status = 'pending'), 'but the offer expires at least 10 minutes before the start');
select pg_temp.as_system();
update public.businesses set min_notice_minutes = 60 where id = (select a from ids);

-- ---------- sweep housekeeping: lost offers, past days, booked elsewhere (WLT-05) ----------
delete from public.waitlist_offers;
delete from public.appointments;
update public.waitlist_entries set status = 'cancelled';
select pg_temp.as_service();
create temp table appt6 as select (pg_temp.book((select day from ids) + interval '16 hours', '+972502000006', 'wl-key-0007')->>'id')::uuid as id;
grant select on appt6 to service_role;
select pg_temp.as_system();
update public.waitlist_entries set status = 'waiting', on_date = (select d1 from dates) where id in (select e1 from e union select e2 from e);
select pg_temp.as_service();
select public.public_cancel((select id from appt6));
select is((select count(*)::int from public.waitlist_offers where status = 'pending'), 1, 'a live offer exists for 16:00');
select throws_ok($$ select pg_temp.book((select day from ids) + interval '16 hours', '+972502000007', 'wl-key-0008') $$, 'P0001', 'slot_taken', 'the public cannot book a slot with a live offer');
select pg_temp.as_system();   -- the owner books it by hand
insert into public.customers (business_id, full_name, phone) select a, 'ידני 7', '+972502000007' from ids;
insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, source, starts_at, ends_at, blocked_until, service_snapshot, price_cents)
  select a, (select id from public.resources where business_id = a and is_default), (select s30 from ids), (select id from public.customers where phone = '+972502000007' and business_id = a), 'TR-HAND07', 'confirmed', 'manual',
         (select day from ids) + interval '16 hours', (select day from ids) + interval '16 hours 30 minutes', (select day from ids) + interval '16 hours 30 minutes', '{"name":"x","durationMinutes":30,"bufferMinutes":0,"priceCents":8000}'::jsonb, 8000 from ids;
select pg_temp.as_service();
select is((select public.waitlist_sweep(now()))->>'lost', '1', 'the sweep marks an offer lost once the owner booked the slot by hand');
select is((select status from public.waitlist_entries where id = (select e1 from e)), 'waiting', 'its owner is back on the list');
select pg_temp.as_system();
update public.waitlist_entries set on_date = (now() at time zone 'Asia/Jerusalem')::date - 3 where id = (select e2 from e);
update public.waitlist_entries set status = 'waiting' where id = (select e2 from e);
select pg_temp.as_service();
select is((select public.waitlist_sweep(now()))->>'pastCancelled', '1', 'entries for days that have passed are closed');
-- WLT-05
select pg_temp.as_system();
update public.waitlist_entries set status = 'waiting' where id = (select e1 from e);
select pg_temp.as_service();
select pg_temp.book((select day from ids) + interval '9 hours', '+972501000001', 'wl-key-0009');   -- E1's own customer books the same service the same day
select is((select public.waitlist_sweep(now()))->>'bookedElsewhere', '1', 'WLT-05: a customer who booked the same thing meanwhile leaves the list');
select is((select status from public.waitlist_entries where id = (select e1 from e)), 'booked', 'the entry is closed as booked');

-- ---------- guards ----------
select pg_temp.as_system();
alter table public.waitlist_entries enable trigger waitlist_entries_guard;
select throws_ok($$ insert into public.waitlist_entries (business_id, service_id, customer_id, on_date) select a, (select sb from ids), (select id from public.customers where business_id = (select a from ids) limit 1), (select d1 from dates) from ids $$, 'P0001', 'tenant_mismatch', 'a service of another business cannot be smuggled into an entry');
select throws_ok($$ update public.waitlist_entries set on_date = on_date + 1 where id = (select e1 from e) $$, 'P0001', 'waitlist_immutable', 'the wanted day cannot be rewritten');
select throws_ok($$ insert into public.notification_log (business_id, type, recipient) select a, 'waitlist_offer', 'customer' from ids $$, '23514', null, 'a notification must target an appointment or an offer');
select throws_ok($$ insert into public.notification_log (business_id, appointment_id, offer_id, type, recipient) select a, (select id from appt5), gen_random_uuid(), 'reminder', 'customer' from ids $$, null, null, 'not both');

-- ---------- RLS ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000005a3');
select ok((select count(*) from public.waitlist_entries) >= 3, 'staff see the waitlist');
select ok((select count(*) from public.waitlist_offers) >= 1, 'and its offers');
select pg_temp.as_user('00000000-0000-0000-0000-0000000005b1');
select is((select count(*)::int from public.waitlist_entries), 0, 'SEC-01: another business sees no entries');
select is((select count(*)::int from public.waitlist_offers), 0, 'nor offers');
select pg_temp.as_anon();
select throws_ok($$ select * from public.waitlist_entries $$, '42501', null, 'anon has no access to the waitlist');

select pg_temp.as_system();
select is_empty($$ select * from private.lint_violations() $$, 'schema lint is clean after the stage 7 migration');
select * from finish();
rollback;
