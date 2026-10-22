-- pgTAP: the export audit line needs the export feature, like the export itself (Strix 2026-10-22).
begin;
select * from no_plan();

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000f5a1', 'authenticated', 'authenticated', 'ea-owner@example.com', now(), '{}', '{}', now(), now());
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000f5a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'ea-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[]') $$, 'a business exists (in its trial, which includes export)');
select pg_temp.as_system();
create temp table ids as select id as b from public.businesses where slug = 'ea-alpha';
grant select on ids to authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-00000000f5a1');
select lives_ok($$ select public.export_audit((select b from ids), 'customers', 3) $$, 'with the feature, the export is recorded');
select pg_temp.as_system();
update public.subscriptions set plan_id = 'starter', status = 'active', trial_ends_at = null, current_period_end = now() + interval '30 days' where business_id = (select b from ids);
select ok(not private.entitlement_can((select b from ids), 'export'), 'on the starter plan the export feature is off');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f5a1');
select throws_ok($$ select public.export_audit((select b from ids), 'customers', 999) $$, 'P0001', 'plan_required', 'without the feature an export line cannot be written');
select pg_temp.as_system();
select is((select count(*)::int from public.audit_log where business_id = (select b from ids) and action = 'export.customers'), 1, 'only the genuine export is in the log');

select * from finish();
rollback;
