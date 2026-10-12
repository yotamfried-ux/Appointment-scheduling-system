-- pgTAP: reports (RPT-04/05), customers (NSH-05, SEC-09), anonymization (CMP-02), export audit, tenant isolation.
-- Expected numbers are worked out by hand from a fixed dataset that spans the Israel DST change (2026-03-27) and sits on both sides of midnight.
begin;
select * from no_plan();

delete from public.notification_log;
delete from public.waitlist_offers;
delete from public.waitlist_entries;
delete from public.domain_events;
delete from public.appointments;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000006a1', 'authenticated', 'authenticated', 'r-owner@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000006a2', 'authenticated', 'authenticated', 'r-staff@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000006b1', 'authenticated', 'authenticated', 'r-other@example.com', now(), '{}', '{}', now(), now());

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
create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000006a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'rp-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80},{"name":"צבע","durationMinutes":60,"priceNis":200}]',
  '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner A creates a business');
select pg_temp.as_user('00000000-0000-0000-0000-0000000006b1');
select lives_ok($$ select public.create_business('מספרה ב', 'barber', null, 'rp-beta', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]',
  '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner B creates a business');
select pg_temp.as_system();
insert into public.business_members (business_id, user_id, role) select id, '00000000-0000-0000-0000-0000000006a2', 'staff' from public.businesses where slug = 'rp-alpha';
create temp table ids as select
  (select id from public.businesses where slug = 'rp-alpha') as a, (select id from public.businesses where slug = 'rp-beta') as b,
  (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'rp-alpha' and s.name = 'תספורת') as s1,
  (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'rp-alpha' and s.name = 'צבע') as s2,
  (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'rp-beta') as sb;
grant select on ids to authenticated, anon;
select is((select timezone from public.businesses where id = (select a from ids)), 'Asia/Jerusalem', 'the business time zone is Israel');

insert into public.customers (business_id, full_name, phone, email) values
  ((select a from ids), 'דנה כהן', '+972501000001', 'dana@example.com'),
  ((select a from ids), 'יוסי לוי', '+972501000002', null),
  ((select a from ids), 'רונית דאהר', '+972501000003', null),
  ((select a from ids), 'עמית פרידמן', '+972501000004', null),
  ((select a from ids), 'שירה מזרחי', '+972501000005', null),
  ((select a from ids), 'משה עתידי', '+972501000006', null),
  ((select a from ids), 'ד%ר _נקודה', '+972501000007', null),
  ((select b from ids), 'לקוח של ב', '+972501000001', null);
create temp table c as select
  (select id from public.customers where phone = '+972501000001' and business_id = (select a from ids)) as c1,
  (select id from public.customers where phone = '+972501000002' and business_id = (select a from ids)) as c2,
  (select id from public.customers where phone = '+972501000003' and business_id = (select a from ids)) as c3,
  (select id from public.customers where phone = '+972501000004' and business_id = (select a from ids)) as c4,
  (select id from public.customers where phone = '+972501000005' and business_id = (select a from ids)) as c5,
  (select id from public.customers where phone = '+972501000006' and business_id = (select a from ids)) as c6,
  (select id from public.customers where phone = '+972501000007' and business_id = (select a from ids)) as c7,
  (select id from public.customers where business_id = (select b from ids)) as cb;
grant select on c to authenticated, anon;

create function pg_temp.ins(p_biz uuid, p_local text, p_status text, p_cust uuid, p_service uuid, p_name text, p_price int) returns void language plpgsql as $$
declare v_start timestamptz := p_local::timestamp at time zone 'Asia/Jerusalem';
begin
  insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, starts_at, ends_at, blocked_until, service_snapshot, price_cents, intake, owner_note)
  values (p_biz, (select id from public.resources where business_id = p_biz and is_default), p_service, p_cust, 'TR-' || upper(substr(md5(random()::text), 1, 6)), p_status, v_start, v_start + interval '30 minutes', v_start + interval '30 minutes',
          jsonb_build_object('name', p_name, 'durationMinutes', 30, 'bufferMinutes', 0, 'priceCents', p_price), p_price, '{"goal":"סודי"}', 'הערה פרטית');
end $$;

-- ===== the hand-checked dataset (period under test: 2026-03-25 .. 2026-03-31, local days) =====
select pg_temp.ins((select a from ids), '2026-03-20 10:00', 'completed', (select c1 from c), (select s1 from ids), 'תספורת', 8000);        -- before the period: makes dana a RETURNING customer
select pg_temp.ins((select a from ids), '2026-03-24 23:59', 'completed', (select c5 from c), (select s1 from ids), 'תספורת', 8000);        -- last minute BEFORE the period
select pg_temp.ins((select a from ids), '2026-03-25 10:00', 'completed', (select c1 from c), (select s1 from ids), 'תספורת', 8000);
select pg_temp.ins((select a from ids), '2026-03-25 11:00', 'completed', (select c2 from c), (select s2 from ids), 'צבע', 20000);
select pg_temp.ins((select a from ids), '2026-03-26 23:30', 'completed', (select c1 from c), (select s1 from ids), 'תספורת', 8000);        -- late evening, UTC+2
select pg_temp.ins((select a from ids), '2026-03-27 00:30', 'no_show', (select c3 from c), (select s1 from ids), 'תספורת', 8000);          -- just after midnight, on the DST day
select pg_temp.ins((select a from ids), '2026-03-27 10:00', 'cancelled_by_customer', (select c2 from c), (select s1 from ids), 'תספורת', 8000);
select pg_temp.ins((select a from ids), '2026-03-27 11:00', 'cancelled_by_business', (select c1 from c), (select s1 from ids), 'תספורת', 8000);
select pg_temp.ins((select a from ids), '2026-03-28 00:30', 'completed', (select c3 from c), (select s1 from ids), 'תספורת', 8000);        -- after the clock change (UTC+3)
select pg_temp.ins((select a from ids), '2026-03-28 12:00', 'confirmed', (select c2 from c), (select s2 from ids), 'צבע', 20000);
select pg_temp.ins((select a from ids), '2026-03-29 09:00', 'pending', (select c4 from c), (select s1 from ids), 'תספורת', 8000);
select pg_temp.ins((select a from ids), '2026-03-31 23:59', 'completed', (select c4 from c), (select s1 from ids), 'תספורת', 8000);        -- last minute INSIDE the period
select pg_temp.ins((select a from ids), '2026-04-01 00:00', 'completed', (select c4 from c), (select s1 from ids), 'תספורת', 8000);        -- first minute AFTER the period
select pg_temp.ins((select b from ids), '2026-03-26 10:00', 'completed', (select cb from c), (select sb from ids), 'תספורת', 9999);         -- another business: never in A's numbers

-- ---------- the report (RPT-04) ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000006a1');
create temp table rep as select public.owner_report((select a from ids), '2026-03-25', '2026-03-31') as j;
grant select on rep to authenticated;
select is((select count(*)::int from jsonb_array_elements((select j from rep)->'rows')), 10, 'ten (day × service × status) groups in the period');
select is((select sum((r->>'n')::int)::int from jsonb_array_elements((select j from rep)->'rows') r), 10, 'ten appointments in the period (the minute before and the minute after are out)');
select is((select sum((r->>'n')::int)::int from jsonb_array_elements((select j from rep)->'rows') r where r->>'status' = 'completed'), 5, 'five completed visits');
select is((select sum((r->>'cents')::bigint)::int from jsonb_array_elements((select j from rep)->'rows') r where r->>'status' = 'completed'), 52000, 'revenue of completed visits: 8000+20000+8000+8000+8000');
select is((select (r->>'n')::int from jsonb_array_elements((select j from rep)->'rows') r where r->>'date' = '2026-03-26' and r->>'status' = 'completed'), 1, 'RPT-04: 23:30 on the 26th belongs to the 26th');
select is((select (r->>'status') from jsonb_array_elements((select j from rep)->'rows') r where r->>'date' = '2026-03-27' and r->>'service' = 'תספורת' and (r->>'status') = 'no_show'), 'no_show', 'RPT-04: 00:30 on the 27th (22:30 UTC the day before) belongs to the 27th');
select is((select (r->>'n')::int from jsonb_array_elements((select j from rep)->'rows') r where r->>'date' = '2026-03-28' and r->>'status' = 'completed'), 1, 'RPT-04: 00:30 on the 28th (UTC+3 after the clock change) belongs to the 28th');
select is((select count(*)::int from jsonb_array_elements((select j from rep)->'rows') r where r->>'date' = '2026-03-27'), 3, 'the 27th holds the no-show and both cancellations');
select is((select count(*)::int from jsonb_array_elements((select j from rep)->'rows') r where r->>'date' = '2026-03-30'), 0, 'a day with nothing has no rows (the application zero-fills)');
select is((select sum((r->>'cents')::bigint)::int from jsonb_array_elements((select j from rep)->'rows') r where r->>'status' = 'completed' and r->>'date' = '2026-03-31'), 8000, 'the last minute of the last day is included');
select is((select (j->>'newCustomers')::int from rep), 3, 'new customers: those whose first real appointment is in the period (dana already came on the 20th)');
select is((select (j->>'returningCustomers')::int from rep), 1, 'returning customers: dana');
select is((select j->>'timezone' from rep), 'Asia/Jerusalem', 'the report states the time zone it used');
select is((select (r->>'n')::int from jsonb_array_elements((select j from rep)->'rows') r where r->>'status' = 'completed' and r->>'cents' = '9999'), null, 'the other business''s 9999 never appears');

-- ---------- validation, empty state, isolation, privileges ----------
select throws_ok($$ select public.owner_report((select a from ids), '2026-03-31', '2026-03-25') $$, '23514', 'invalid_range', 'an inverted range is refused');
select throws_ok($$ select public.owner_report((select a from ids), '2024-01-01', '2026-03-25') $$, '23514', 'invalid_range', 'a range longer than 400 days is refused');
select throws_ok($$ select public.owner_report((select a from ids), null, '2026-03-25') $$, '23514', 'invalid_range', 'a missing bound is refused');
select pg_temp.as_system();
insert into public.businesses (name, kind, slug, created_by, timezone) select 'חדש', 'barber', 'rp-empty', '00000000-0000-0000-0000-0000000006a1', 'Asia/Jerusalem';
insert into public.business_members (business_id, user_id, role) select id, '00000000-0000-0000-0000-0000000006a1', 'owner' from public.businesses where slug = 'rp-empty';
select pg_temp.as_user('00000000-0000-0000-0000-0000000006a1');
select is((select public.owner_report((select id from public.businesses where slug = 'rp-empty'), '2026-03-25', '2026-03-31')->'rows'), '[]'::jsonb, 'RPT-05: a new business has an empty report, not an error');
select is((select (public.owner_report((select id from public.businesses where slug = 'rp-empty'), '2026-03-25', '2026-03-31')->>'newCustomers')::int), 0, 'with zero customers');
select pg_temp.as_user('00000000-0000-0000-0000-0000000006b1');
select is((select public.owner_report((select a from ids), '2026-03-25', '2026-03-31')), null, 'SEC-01: another business gets nothing for this business id');
select is((select count(*)::int from public.owner_customers((select a from ids))), 0, 'SEC-01: nor its customers');
select is((select public.owner_customer_detail((select c1 from c))), null, 'SEC-01: nor a customer card');
select pg_temp.as_anon();
select throws_ok($$ select public.owner_report((select a from ids), '2026-03-25', '2026-03-31') $$, '42501', null, 'anon cannot call the report');
select throws_ok($$ select * from public.owner_customers((select a from ids)) $$, '42501', null, 'anon cannot list customers');

-- ---------- customers ----------
select pg_temp.as_system();
select pg_temp.ins((select a from ids), to_char(now() at time zone 'Asia/Jerusalem' - interval '10 days', 'YYYY-MM-DD HH24:MI'), 'no_show', (select c5 from c), (select s1 from ids), 'תספורת', 8000);     -- recent no-show
select pg_temp.ins((select a from ids), to_char(now() at time zone 'Asia/Jerusalem' - interval '90 days', 'YYYY-MM-DD HH24:MI'), 'no_show', (select c5 from c), (select s1 from ids), 'תספורת', 8000);    -- old no-show
select pg_temp.ins((select a from ids), to_char(now() at time zone 'Asia/Jerusalem' + interval '3 days', 'YYYY-MM-DD HH24:MI'), 'confirmed', (select c6 from c), (select s1 from ids), 'תספורת', 8000);   -- upcoming
select pg_temp.as_user('00000000-0000-0000-0000-0000000006a2');   -- staff may read customers
create temp table list as select * from public.owner_customers((select a from ids), null, 'name');
grant select on list to authenticated;
select is((select count(*)::int from list), 7, 'seven customers in business A (the other business is separate)');
select is((select total from list limit 1), 7::bigint, 'the total counts every match, not just the page');
select is((select visits from list where phone = '+972501000001'), 3, 'dana: three completed visits (20th, 25th, 26th)');
select is((select spent_cents from list where phone = '+972501000001'), 24000::bigint, 'dana spent 3 × 80');
select is((select last_visit from list where phone = '+972501000001'), '2026-03-26 23:30'::timestamp at time zone 'Asia/Jerusalem', 'her last visit is the late evening of the 26th');
select is((select cancellations from list where phone = '+972501000002'), 1, 'yossi cancelled once himself');
select is((select cancellations from list where phone = '+972501000001'), 0, 'a cancellation by the business is not the customer''s');
select is((select no_shows from list where phone = '+972501000005'), 2, 'shira: two no-shows in total');
select is((select no_shows_60d from list where phone = '+972501000005'), 1, 'NSH-05: only the one in the last 60 days counts for the rolling window');
select is((select upcoming from list where phone = '+972501000006'), 1, 'moshe has one upcoming appointment');
select is((select upcoming from list where phone = '+972501000004'), 0, 'a pending appointment in the past is not upcoming');
select is((select string_agg(full_name, ',' order by full_name) from (select full_name from public.owner_customers((select a from ids), null, 'name', 2, 0)) x), (select string_agg(full_name, ',' order by full_name) from (select full_name from list order by full_name limit 2) y), 'sorting by name and paging agree');
select is((select (array_agg(phone order by ord))[1] from (select phone, row_number() over () ord from public.owner_customers((select a from ids), null, 'visits')) x), '+972501000001', 'sorted by visits: dana first');
select is((select count(*)::int from public.owner_customers((select a from ids), null, 'name', 3, 5)), 2, 'paging: offset 5 of 7 leaves two');
select is((select count(*)::int from public.owner_customers((select a from ids), 'דנה')), 1, 'search by name');
select is((select count(*)::int from public.owner_customers((select a from ids), 'כהן')), 1, 'search by a part of the name');
select is((select count(*)::int from public.owner_customers((select a from ids), '050-100-0003')), 1, 'search by phone in the local form with punctuation (stored as +97250…)');
select is((select count(*)::int from public.owner_customers((select a from ids), '+972501000003')), 1, 'and in the international form');
select is((select count(*)::int from public.owner_customers((select a from ids), '03')), 0, 'two digits are not a phone search (they would match everything)');
select is((select count(*)::int from public.owner_customers((select a from ids), '%')), 1, 'SEC-09: a % in the search is a literal — it finds only the name that contains one');
select is((select count(*)::int from public.owner_customers((select a from ids), '_')), 1, 'SEC-09: and so is _');
select is((select count(*)::int from public.owner_customers((select a from ids), $$'; drop table public.customers; --$$)), 0, 'SEC-09: an injection attempt is just text that matches nothing');
select is((select count(*)::int from public.owner_customers((select a from ids), 'nobody-by-that-name')), 0, 'no match is an empty list');
select ok((select count(*) from public.customers) > 0, 'the customers table is intact');

-- detail
select is((public.owner_customer_detail((select c1 from c))->'stats'->>'visits')::int, 3, 'detail: visits agree with the list');
select is(jsonb_array_length(public.owner_customer_detail((select c1 from c))->'appointments'), 4, 'detail: dana has four appointments in all (3 completed, 1 cancelled by the business)');
select is((public.owner_customer_detail((select c1 from c))->'appointments'->0->>'status'), 'cancelled_by_business', 'the newest appointment comes first (27 March)');

-- keyset page for exports: a data source for managers whose plan includes the export; staff cannot page through it directly
select is((select count(*)::int from public.owner_customers_page((select a from ids), null, 3)), 0, 'keyset page: staff get nothing (the export is for managers)');
select pg_temp.as_user('00000000-0000-0000-0000-0000000006a1');
select is((select count(*)::int from public.owner_customers_page((select a from ids), null, 3)), 3, 'keyset page: first three');
select is((select count(*)::int from public.owner_customers_page((select a from ids), (select id from public.owner_customers_page((select a from ids), null, 3) order by id desc limit 1), 100)), 4, 'keyset page: the rest after the third');
select pg_temp.as_user('00000000-0000-0000-0000-0000000006a2');

-- ---------- notes ----------
select lives_ok($$ select public.set_customer_notes((select c1 from c), 'מעדיפה בוקר') $$, 'staff may write a note');
select is((select notes from public.owner_customers((select a from ids), 'דנה')), 'מעדיפה בוקר', 'the note is on the card');
select throws_ok($$ select public.set_customer_notes((select c1 from c), repeat('א', 501)) $$, '23514', 'notes_too_long', 'a note is at most 500 characters');
select pg_temp.as_user('00000000-0000-0000-0000-0000000006b1');
select throws_ok($$ select public.set_customer_notes((select c1 from c), 'זר') $$, '42501', 'forbidden', 'SEC-01: another business cannot write notes');
select throws_ok($$ select public.anonymize_customer((select c1 from c)) $$, '42501', 'forbidden', 'nor anonymize');

-- ---------- anonymization (CMP-02) ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000006a2');
select throws_ok($$ select public.anonymize_customer((select c1 from c)) $$, '42501', 'forbidden', 'staff cannot anonymize (admin only)');
select pg_temp.as_user('00000000-0000-0000-0000-0000000006a1');
select is((public.anonymize_customer((select c6 from c)))->>'outcome', 'has_upcoming', 'a customer with an upcoming appointment is not erased');
select is((select full_name from public.customers where id = (select c6 from c)), 'משה עתידי', 'and nothing changed');
create temp table before as select (select count(*) from jsonb_array_elements(public.owner_report((select a from ids), '2026-03-25', '2026-03-31')->'rows')) as groups,
  (select sum((r->>'cents')::bigint) from jsonb_array_elements(public.owner_report((select a from ids), '2026-03-25', '2026-03-31')->'rows') r) as cents;
grant select on before to authenticated;
select pg_temp.as_system();
insert into public.waitlist_entries (business_id, service_id, customer_id, on_date) values ((select a from ids), (select s1 from ids), (select c1 from c), current_date + 5);
select pg_temp.as_user('00000000-0000-0000-0000-0000000006a1');
select is((public.anonymize_customer((select c1 from c)))->>'outcome', 'anonymized', 'dana is anonymized');
select is((select full_name from public.customers where id = (select c1 from c)), 'לקוח שנמחק', 'the name is gone');
select ok((select phone from public.customers where id = (select c1 from c)) ~ '^\+999[0-9]{10}$', 'the phone is replaced by an unreachable placeholder');
select is((select email || notes from public.customers where id = (select c1 from c)), null, 'e-mail and notes are gone');
select ok((select anonymized_at is not null from public.customers where id = (select c1 from c)), 'the erasure is stamped');
select is((select count(*)::int from public.appointments where customer_id = (select c1 from c) and (intake <> '{}'::jsonb or owner_note is not null)), 0, 'provider-only answers and private notes of her appointments are cleared');
select is((select count(*)::int from public.appointments where customer_id = (select c1 from c)), 4, 'but her appointments stay (service, price and time)');
select is((select status from public.waitlist_entries where customer_id = (select c1 from c)), 'cancelled', 'her waitlist entries are closed');
select is((select count(*) from jsonb_array_elements(public.owner_report((select a from ids), '2026-03-25', '2026-03-31')->'rows')), (select groups from before), 'the report is unchanged after the erasure');
select is((select sum((r->>'cents')::bigint) from jsonb_array_elements(public.owner_report((select a from ids), '2026-03-25', '2026-03-31')->'rows') r), (select cents from before), 'and so is the revenue');
select ok((select count(*) from public.audit_log where action = 'customer.anonymize' and business_id = (select a from ids)) = 1, 'the erasure is audited');
select is((public.anonymize_customer((select c1 from c)))->>'outcome', 'already', 'erasing twice is harmless');
select throws_ok($$ select public.set_customer_notes((select c1 from c), 'x') $$, 'P0001', 'anonymized', 'an anonymized customer cannot get new notes');
select pg_temp.as_system();
select throws_ok($$ update public.appointments set intake = '{"x":1}'::jsonb where customer_id = (select c2 from c) $$, 'P0001', 'appointment_immutable', 'outside the erasure function the intake is still immutable');
select is(current_setting('app.anonymizing', true), 'off', 'the erasure flag is switched off again');

-- ---------- export audit ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000006a1');
select lives_ok($$ select public.export_audit((select a from ids), 'customers', 1234) $$, 'an export is audited by an admin');
select is((select (meta->>'rows')::int from public.audit_log where action = 'export.customers' and business_id = (select a from ids)), 1234, 'with its row count');
select throws_ok($$ select public.export_audit((select a from ids), 'secrets', 1) $$, '23514', 'invalid_kind', 'only known export kinds');
select pg_temp.as_user('00000000-0000-0000-0000-0000000006a2');
select throws_ok($$ select public.export_audit((select a from ids), 'customers', 1) $$, '42501', 'forbidden', 'staff cannot export');

select pg_temp.as_system();
select is_empty($$ select * from private.lint_violations() $$, 'schema lint is clean after the stage 8 migration');
select * from finish();
rollback;
