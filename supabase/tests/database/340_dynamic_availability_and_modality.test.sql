-- pgTAP: dynamic availability (unlimited windows + minute precision + FOR UPDATE locking) and appointment modality (services.locations + location enforcement).
begin;
select * from no_plan();

delete from public.notification_log; delete from public.waitlist_offers; delete from public.waitlist_entries; delete from public.domain_events; delete from public.appointments;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000d340', 'authenticated', 'authenticated', 'd340-owner@example.com', now(), '{}', '{}', now(), now());
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true); set local role service_role; end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

-- 1. Create a tutor business with 6 non-round availability intervals on weekday 0 and 3 services (both, online-only, frontal-only)
select pg_temp.as_user('00000000-0000-0000-0000-00000000d340');
select lives_ok($$
  select public.create_business(
    'מורה פרטי מתמטיקה',
    'teacher',
    null,
    'd340-tutor',
    '[
      {"name":"שיעור היברידי","durationMinutes":60,"priceNis":180,"locations":["business","online"]},
      {"name":"שיעור אונליין בלבד","durationMinutes":60,"priceNis":160,"locations":["online"]},
      {"name":"שיעור פרונטלי בלבד","durationMinutes":60,"priceNis":200,"locations":["business"]}
    ]'::jsonb,
    '[
      {
        "weekday":0,
        "open":true,
        "windows":[
          {"from":"08:00","to":"09:00"},
          {"from":"10:15","to":"11:15"},
          {"from":"13:00","to":"14:00"},
          {"from":"16:30","to":"17:30"},
          {"from":"19:00","to":"20:00"},
          {"from":"20:30","to":"21:30"}
        ]
      }
    ]'::jsonb
  )
$$, 'owner creates tutor business with 6 intervals and explicit service locations');

select pg_temp.as_system();
update public.businesses set published_at = now() where slug = 'd340-tutor';

create temp table ids as
  select
    (select id from public.businesses where slug = 'd340-tutor') as b,
    (select id from public.resources where business_id = (select id from public.businesses where slug = 'd340-tutor') and is_default) as r,
    (select id from public.services where business_id = (select id from public.businesses where slug = 'd340-tutor') and name = 'שיעור היברידי') as s_hybrid,
    (select id from public.services where business_id = (select id from public.businesses where slug = 'd340-tutor') and name = 'שיעור אונליין בלבד') as s_online,
    (select id from public.services where business_id = (select id from public.businesses where slug = 'd340-tutor') and name = 'שיעור פרונטלי בלבד') as s_frontal;
grant select on ids to authenticated, service_role;

-- Verify 6 availability rules were persisted with minute precision (10:15 = 615, 11:15 = 675)
select is(
  (select count(*)::int from public.availability_rules where business_id = (select b from ids) and weekday = 0),
  6,
  '6 availability windows persisted for weekday 0'
);
select is(
  (select array_agg(start_minute || '-' || end_minute order by start_minute) from public.availability_rules where business_id = (select b from ids) and weekday = 0),
  array['480-540','615-675','780-840','990-1050','1140-1200','1230-1290'],
  'all 6 windows (including 10:15-11:15) match exact minutes'
);

-- 2. Update hours to 10 non-overlapping windows (including custom minutes like 06:17-07:22, 09:05-10:35, 22:10-23:40)
select pg_temp.as_user('00000000-0000-0000-0000-00000000d340');
select lives_ok($$
  select public.replace_weekly_hours(
    (select b from ids),
    '[
      {
        "weekday":0,
        "open":true,
        "windows":[
          {"from":"06:17","to":"07:22"},
          {"from":"07:30","to":"08:30"},
          {"from":"09:05","to":"10:35"},
          {"from":"10:45","to":"11:45"},
          {"from":"12:00","to":"13:00"},
          {"from":"13:15","to":"14:15"},
          {"from":"15:00","to":"16:00"},
          {"from":"16:30","to":"17:30"},
          {"from":"19:00","to":"20:00"},
          {"from":"22:10","to":"23:40"}
        ]
      }
    ]'::jsonb
  )
$$, 'owner updates weekday 0 to 10 custom-minute windows');

select pg_temp.as_system();
select is(
  (select count(*)::int from public.availability_rules where business_id = (select b from ids) and weekday = 0),
  10,
  '10 windows persisted after update_hours'
);

-- 3. Overlap rejection at DB level (EXCLUDE constraint)
select pg_temp.as_user('00000000-0000-0000-0000-00000000d340');
select throws_ok($$
  select public.replace_weekly_hours(
    (select b from ids),
    '[{"weekday":0,"open":true,"windows":[{"from":"10:00","to":"11:00"},{"from":"10:30","to":"11:30"}]}]'::jsonb
  )
$$, '23P01', null, 'overlapping windows in the same day are rejected by the DB');

-- Touching windows (10:00-11:00 and 11:00-12:00) are allowed
select lives_ok($$
  select public.replace_weekly_hours(
    (select b from ids),
    '[{"weekday":0,"open":true,"windows":[{"from":"10:00","to":"11:00"},{"from":"11:00","to":"12:00"}]}]'::jsonb
  )
$$, 'touching windows 10:00-11:00 and 11:00-12:00 are accepted');

-- 4. Public catalog exposes per-service locations
select pg_temp.as_service();
select is(
  (select (s->>'locations')::jsonb from jsonb_array_elements(public.public_catalog('d340-tutor')->'services') s where s->>'name' = 'שיעור אונליין בלבד'),
  '["online"]'::jsonb,
  'public_catalog exposes ["online"] for online-only service'
);
select is(
  (select (s->>'locations')::jsonb from jsonb_array_elements(public.public_catalog('d340-tutor')->'services') s where s->>'name' = 'שיעור פרונטלי בלבד'),
  '["business"]'::jsonb,
  'public_catalog exposes ["business"] for frontal-only service'
);

-- 5. Booking modality enforcement in public_book_team
-- 5a. Booking online on online-only service succeeds and returns location = 'online'
create temp table bk_online as
  select public.public_book_team(
    (select b from ids),
    (select s_online from ids),
    now() + interval '2 days',
    'דנה אונליין',
    '+972501112201',
    'dana-online@example.com',
    'online',
    '{}',
    'd340-idem-1',
    'hash-d340-1',
    null::uuid[],
    false
  ) as r;
grant select on bk_online to authenticated, service_role;

select is((select r->>'location' from bk_online), 'online', 'public_book_team returns location = online');
select is(
  (select public.public_get_appointment(((select r->>'id' from bk_online))::uuid)->>'location'),
  'online',
  'public_get_appointment returns location = online'
);

-- 5b. Booking frontal ('business') on online-only service fails with invalid_location (23514)
select throws_ok($$
  select public.public_book_team(
    (select b from ids),
    (select s_online from ids),
    now() + interval '3 days',
    'דנה שגוי',
    '+972501112202',
    'dana-err@example.com',
    'business',
    '{}',
    'd340-idem-2',
    'hash-d340-2',
    null::uuid[],
    false
  )
$$, '23514', 'invalid_location', 'booking business modality on an online-only service raises invalid_location');

-- 5c. Booking online on frontal-only service fails with invalid_location (23514)
select throws_ok($$
  select public.public_book_team(
    (select b from ids),
    (select s_frontal from ids),
    now() + interval '3 days',
    'דנה שגוי 2',
    '+972501112203',
    'dana-err2@example.com',
    'online',
    '{}',
    'd340-idem-3',
    'hash-d340-3',
    null::uuid[],
    false
  )
$$, '23514', 'invalid_location', 'booking online modality on a frontal-only service raises invalid_location');

-- 5d. Booking frontal ('business') on frontal-only service succeeds
create temp table bk_frontal as
  select public.public_book_team(
    (select b from ids),
    (select s_frontal from ids),
    now() + interval '4 days',
    'נועם פרונטלי',
    '+972501112204',
    'noam-frontal@example.com',
    'business',
    '{}',
    'd340-idem-4',
    'hash-d340-4',
    null::uuid[],
    false
  ) as r;
grant select on bk_frontal to authenticated, service_role;

select is((select r->>'location' from bk_frontal), 'business', 'public_book_team returns location = business');

-- 6. Owner customer detail returns location for each appointment
select pg_temp.as_user('00000000-0000-0000-0000-00000000d340');
select is(
  (
    select (public.owner_customer_detail(c.id)->'appointments'->0->>'location')
    from public.customers c
    where c.business_id = (select b from ids) and c.phone = '+972501112201'
  ),
  'online',
  'owner_customer_detail includes appointment location'
);

-- 7. Schema lint is clean
select pg_temp.as_system();
select is((select count(*)::int from private.lint_violations()), 0, 'the schema lint is clean');

select * from finish();
rollback;
