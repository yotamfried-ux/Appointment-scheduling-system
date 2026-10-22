-- pgTAP: a rejected value never echoes the row back to the caller (Strix VULN-0009). Postgres puts "Failing row contains (...)" into the
-- error DETAIL of a CHECK / NOT NULL violation, and the Data API forwards it. The public wrappers now answer with a short stable error.
begin;
select * from no_plan();

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000f2a1', 'authenticated', 'authenticated', 'nre-owner@example.com', now(), '{}', '{}', now(), now());
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end $$;
-- what a caller of the Data API would see: SQLSTATE, message and detail of the failure
create function pg_temp.err_of(q text) returns text language plpgsql as $$
declare st text; m text; d text;
begin execute q; return 'no error';
exception when others then get stacked diagnostics st = returned_sqlstate, m = message_text, d = pg_exception_detail;
  return st || '|' || m || '|' || coalesce(nullif(d, ''), '(none)');
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000f2a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'nre-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'a business exists');

select is(pg_temp.err_of($$ select public.create_business('x', 'not_a_kind', null, 'nre-beta', '[]', '[]') $$), '23514|invalid_input|(none)', 'create_business: an invalid kind gives a short error and no row in the detail');
select is(pg_temp.err_of($$ select public.create_business('x', 'barber', null, 'nre-gamma', '[{"name":"x","durationMinutes":1,"priceNis":-5}]', '[]') $$), '23514|invalid_input|(none)', 'create_business: an invalid service gives a short error and no row in the detail');
select is(pg_temp.err_of($$ select public.change_business_slug((select id from public.businesses where slug = 'nre-alpha'), 'NOT A VALID SLUG!!') $$), '23514|invalid_input|(none)', 'change_business_slug: the stored row is not echoed');
select is(pg_temp.err_of($$ select public.replace_weekly_hours((select id from public.businesses where slug = 'nre-alpha'), '[{"weekday":9,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$), '23514|invalid_input|(none)', 'replace_weekly_hours: an invalid weekday gives a short error and no row in the detail');

-- the normal failures keep their own stable codes
select throws_ok($$ select public.create_business('xx', 'barber', null, 'nre-alpha', '[{"name":"ok","durationMinutes":30,"priceNis":10}]', '[]') $$, 'P0001', 'slug_taken', 'a taken slug still says slug_taken');

select * from finish();
rollback;
