-- pgTAP: versioned acceptance of the terms and privacy policy (CMP-03) and the appointment's last-change instant (CAL-05).
begin;
select * from no_plan();

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000009a1', 'authenticated', 'authenticated', 'l-one@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000009a2', 'authenticated', 'authenticated', 'l-two@example.com', now(), '{}', '{}', now(), now());

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000009a1');
select lives_ok($$ select public.accept_legal('terms', '2026-10-01') $$, 'a user records an acceptance');
select lives_ok($$ select public.accept_legal('terms', '2026-10-01') $$, 'recording it again is harmless');
select is((select count(*)::int from public.legal_acceptances), 1, '...and stays a single row');
select lives_ok($$ select public.accept_legal('privacy', '2026-10-01') $$, 'privacy is separate from terms');
select lives_ok($$ select public.accept_legal('terms', '2026-11-15.2') $$, 'a newer version is a new row, the old one stays');
select is((select count(*)::int from public.legal_acceptances where doc = 'terms'), 2, 'history is kept');
select throws_ok($$ select public.accept_legal('cookies', '2026-10-01') $$, '23514', null, 'unknown documents are refused');
select throws_ok($$ select public.accept_legal('terms', 'latest') $$, '23514', null, 'versions must look like dates');
select throws_ok($$ update public.legal_acceptances set accepted_at = now() - interval '1 year' $$, '42501', null, 'an acceptance cannot be edited');
select throws_ok($$ delete from public.legal_acceptances $$, '42501', null, 'an acceptance cannot be deleted');
select throws_ok($$ insert into public.legal_acceptances (user_id, doc, version) values ('00000000-0000-0000-0000-0000000009a2', 'terms', '2026-10-01') $$, '42501', null, 'nobody records an acceptance on behalf of another user');

select pg_temp.as_user('00000000-0000-0000-0000-0000000009a2');
select is((select count(*)::int from public.legal_acceptances), 0, 'users see only their own acceptances');
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select throws_ok($$ select * from public.legal_acceptances $$, '42501', null, 'anonymous callers have no access');
select throws_ok($$ select public.accept_legal('terms', '2026-10-01') $$, '42501', null, 'anonymous callers cannot record acceptances');
reset role;

select * from finish();
rollback;
