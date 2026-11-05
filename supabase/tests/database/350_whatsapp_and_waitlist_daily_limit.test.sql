-- pgTAP: WhatsApp opt-in capability (default false) and Waitlist Daily Limit (uniform across all working days).
begin;
select * from no_plan();

delete from public.notification_log;
delete from public.waitlist_offers;
delete from public.waitlist_entries;
delete from public.domain_events;
delete from public.appointments;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000d350', 'authenticated', 'authenticated', 'd350-owner@example.com', now(), '{}', '{}', now(), now());

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
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

-- 1. Create business
select pg_temp.as_user('00000000-0000-0000-0000-00000000d350');
select lives_ok($$
  select public.create_business(
    'סטודיו בדיקת המתנה ווואטסאפ',
    'barber',
    '+972501112233',
    'd350-studio',
    '[{"name":"תספורת","durationMinutes":30,"priceNis":90}]'::jsonb,
    '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]},{"weekday":1,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]'::jsonb
  )
$$, 'owner creates business');

select pg_temp.as_system();
update public.businesses
set published_at = now(), waitlist_enabled = true
where slug = 'd350-studio';

create temp table ids as
  select
    (select id from public.businesses where slug = 'd350-studio') as b,
    (select id from public.services where business_id = (select id from public.businesses where slug = 'd350-studio') limit 1) as s,
    ((now() at time zone 'Asia/Jerusalem')::date + 2) as d1,
    ((now() at time zone 'Asia/Jerusalem')::date + 3) as d2;
grant select on ids to authenticated, service_role;

-- 2. Verify WhatsApp is disabled by default on the business and in plan_features, and waitlist_daily_limit is null by default
select is(
  (select whatsapp_enabled from public.businesses where id = (select b from ids)),
  false,
  'whatsapp_enabled defaults to false (not enabled by default)'
);

select is(
  (select waitlist_daily_limit from public.businesses where id = (select b from ids)),
  null::int,
  'waitlist_daily_limit defaults to null (unlimited)'
);

select is(
  (select bool_value from public.plan_features where plan_id = 'starter' and key = 'whatsapp'),
  false,
  'starter plan has whatsapp feature disabled by default'
);

select is(
  (select bool_value from public.plan_features where plan_id = 'pro' and key = 'whatsapp'),
  false,
  'pro plan has whatsapp feature disabled by default until subscription plan gating is enabled'
);

-- 3. Verify owner can configure waitlist_daily_limit and whatsapp_enabled, and CHECK constraint enforces 1..500
select pg_temp.as_user('00000000-0000-0000-0000-00000000d350');

select throws_ok($$
  update public.businesses set waitlist_daily_limit = 0 where id = (select b from ids)
$$, '23514', null, 'waitlist_daily_limit = 0 is rejected by CHECK constraint');

select throws_ok($$
  update public.businesses set waitlist_daily_limit = 501 where id = (select b from ids)
$$, '23514', null, 'waitlist_daily_limit = 501 is rejected by CHECK constraint');

select lives_ok($$
  update public.businesses
  set waitlist_daily_limit = 2, whatsapp_enabled = true
  where id = (select b from ids)
$$, 'owner updates waitlist_daily_limit = 2 and whatsapp_enabled = true');

-- 4. Test uniform daily waitlist limit across working days (d1 and d2)
select pg_temp.as_service();

-- Customer 1 joins on d1 (spot 1 of 2)
create temp table c1_join as
  select public.waitlist_join(
    (select b from ids),
    (select s from ids),
    (select d1 from ids),
    540,
    720,
    'לקוח א',
    '+972521111111',
    'c1@example.com',
    'idem-c1-d1',
    '2026-04',
    '2026-04'
  ) as res;

select is((select (res->>'replay')::boolean from c1_join), false, 'customer 1 joins waitlist on d1 (1/2)');

-- Idempotent replay of Customer 1 on d1 does not fail or consume a second spot
select is(
  (public.waitlist_join(
    (select b from ids),
    (select s from ids),
    (select d1 from ids),
    540,
    720,
    'לקוח א',
    '+972521111111',
    'c1@example.com',
    'idem-c1-d1',
    '2026-04',
    '2026-04'
  )->>'replay')::boolean,
  true,
  'idempotent replay for customer 1 on d1 succeeds before daily limit check'
);

-- Customer 2 joins on d1 (spot 2 of 2)
select is(
  (public.waitlist_join(
    (select b from ids),
    (select s from ids),
    (select d1 from ids),
    540,
    720,
    'לקוח ב',
    '+972522222222',
    'c2@example.com',
    'idem-c2-d1',
    '2026-04',
    '2026-04'
  )->>'replay')::boolean,
  false,
  'customer 2 joins waitlist on d1 (2/2)'
);

-- Customer 3 tries to join on d1 -> blocked by waitlist_day_full!
select throws_ok($$
  select public.waitlist_join(
    (select b from ids),
    (select s from ids),
    (select d1 from ids),
    540,
    720,
    'לקוח ג',
    '+972523333333',
    'c3@example.com',
    'idem-c3-d1',
    '2026-04',
    '2026-04'
  )
$$, 'P0001', 'waitlist_day_full', 'customer 3 is refused on d1 when daily limit (2) is reached');

-- Customer 3 joins on d2 -> succeeds because the daily limit applies per day across all working days
select is(
  (public.waitlist_join(
    (select b from ids),
    (select s from ids),
    (select d2 from ids),
    540,
    720,
    'לקוח ג',
    '+972523333333',
    'c3@example.com',
    'idem-c3-d2',
    '2026-04',
    '2026-04'
  )->>'replay')::boolean,
  false,
  'customer 3 can join waitlist on d2 (1/2 on d2)'
);

-- Customer 1 leaves the waitlist on d1 -> frees a spot on d1 -> Customer 3 can now join on d1!
select is(
  public.waitlist_leave(((select res->>'id' from c1_join))::uuid)->>'outcome',
  'left',
  'customer 1 leaves waitlist on d1'
);

select is(
  (public.waitlist_join(
    (select b from ids),
    (select s from ids),
    (select d1 from ids),
    540,
    720,
    'לקוח ג',
    '+972523333333',
    'c3@example.com',
    'idem-c3-d1',
    '2026-04',
    '2026-04'
  )->>'replay')::boolean,
  false,
  'customer 3 joins waitlist on d1 after customer 1 left'
);

-- 5. Verify notif_context includes business.whatsappEnabled and customer.phone
select pg_temp.as_system();
create temp table notif_test as
  select public.public_book(
    (select b from ids),
    (select s from ids),
    ((select d1 from ids)::text || ' 10:00:00+02')::timestamptz,
    'לקוח וואטסאפ',
    '+972549998877',
    'wa-cust@example.com',
    'business',
    '{}'::jsonb,
    'idem-wa-book-1',
    'hash-wa-book-1',
    '2026-04',
    '2026-04'
  ) as booked;

create temp table notif_row as
  select private.notif_enqueue(((select booked->>'id' from notif_test))::uuid, 'booking_confirmed', 'customer') as nid;

select is(
  (select (private.notif_context((select nid from notif_row))->'business'->>'whatsappEnabled')::boolean),
  true,
  'notif_context exposes business.whatsappEnabled'
);

select is(
  (select private.notif_context((select nid from notif_row))->'customer'->>'phone'),
  '+972549998877',
  'notif_context exposes customer.phone for WhatsApp delivery'
);

select * from finish();
rollback;
