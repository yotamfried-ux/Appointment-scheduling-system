-- pgTAP: a business kind for gel and manicure businesses ("nails"). The kind list is a database constraint, so it is tested here.
-- Negative control: a made-up kind is still refused by the same constraint.
begin;
select plan(6);

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000e1e1', 'authenticated', 'authenticated', 'nails-owner@example.com', now(), '{}', '{}', now(), now());

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000e1e1');
select lives_ok($$ select public.create_business('סטודיו ללק', 'nails', null, 'nails-studio-a', '[{"name":"לק ג׳ל","durationMinutes":60,"priceNis":120}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"17:00"}]}]') $$, 'a business of kind nails can be created');
select is((select kind from public.businesses where slug = 'nails-studio-a'), 'nails', 'the kind is stored');
select throws_ok($$ select public.create_business('סתם', 'nailz', null, 'nails-studio-b', '[{"name":"x","durationMinutes":30,"priceNis":1}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"17:00"}]}]') $$, '23514', null, 'a made-up kind is still refused');
select lives_ok($$ select public.create_business('מורה', 'teacher', null, 'teacher-studio-a', '[{"name":"שיעור פרטי","durationMinutes":60,"priceNis":150}]', '[{"weekday":0,"open":true,"windows":[{"from":"14:00","to":"20:00"}]}]') $$, 'teacher stays valid');
select is((select count(*)::int from public.businesses where slug in ('nails-studio-a', 'teacher-studio-a')), 2, 'both exist for their owner');
select is((select count(*)::int from public.businesses where slug = 'nails-studio-b'), 0, 'the refused one was not created');

select * from finish();
rollback;
