-- pgTAP: abuse controls on publication (Strix VULN-0011, docs/05 §5.11): sensitive names wait for an operator, a suspended business is taken down and cannot republish.
begin;
select * from no_plan();

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000f4a1', 'authenticated', 'authenticated', 'ac-owner@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000f4c1', 'authenticated', 'authenticated', 'ac-admin@example.com', now(), '{}', '{}', now(), now());
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-00000000f4c1');
create function pg_temp.as_user(p_uid uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true); set local role authenticated; end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

-- the screen itself
select ok(private.sensitive_name('בנק הפועלים סניף 12'), 'a bank name is sensitive');
select ok(private.sensitive_name('Bank of Hadar'), 'a Latin bank name is sensitive (case-insensitive)');
select ok(private.sensitive_name('PayPal Support'), 'a payment brand is sensitive');
select ok(not private.sensitive_name('מספרת הדר'), 'an ordinary business name is not');
select ok(not private.sensitive_name(null), 'no name, no match');

select pg_temp.as_user('00000000-0000-0000-0000-00000000f4a1');
select lives_ok($$ select public.create_business('מספרה רגילה', 'barber', null, 'ac-plain', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[]') $$, 'an ordinary business is created');
select lives_ok($$ select public.create_business('בנק הדר', 'barber', null, 'ac-bank', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[]') $$, 'a sensitive name can still be created (it is only held back at publication)');
select pg_temp.as_system();
create temp table ids as select (select id from public.businesses where slug = 'ac-plain') as plain, (select id from public.businesses where slug = 'ac-bank') as bank;
grant select on ids to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000f4a1');
select lives_ok($$ select public.publish_business((select plain from ids)) $$, 'an ordinary business publishes');
select throws_ok($$ select public.publish_business((select bank from ids)) $$, 'P0001', 'needs_review', 'a sensitive name is held for review');
select is((select published_at is null from public.businesses where slug = 'ac-bank'), true, '...and stays unpublished');

-- an owner cannot approve or suspend
select throws_ok($$ select public.admin_approve_brand((select bank from ids), 'אני מאשר את עצמי') $$, '42501', null, 'an owner cannot approve their own name');
select throws_ok($$ select public.admin_set_suspension((select plain from ids), true, 'ניסיון') $$, '42501', null, 'an owner cannot use the kill switch');
select throws_ok($$ update public.businesses set suspended_at = null, brand_reviewed_at = now() where slug = 'ac-bank' $$, '42501', null, 'the two columns are not writable by an owner');
select pg_temp.as_system();

-- operator: needs MFA, then approves
select pg_temp.as_user('00000000-0000-0000-0000-00000000f4c1', 'aal1');
select throws_ok($$ select public.admin_approve_brand((select bank from ids), 'שם נבדק מול העסק') $$, '42501', null, 'an operator needs a second factor');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f4c1', 'aal2');
select lives_ok($$ select public.admin_approve_brand((select bank from ids), 'שם נבדק מול העסק') $$, 'an operator with MFA approves the name');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f4a1');
select lives_ok($$ select public.publish_business((select bank from ids)) $$, 'after approval the business publishes');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f4c1', 'aal2');

-- kill switch
select lives_ok($$ select public.admin_set_suspension((select plain from ids), true, 'דיווח על התחזות') $$, 'an operator suspends a business');
select pg_temp.as_system();
select is((select published_at is null and suspended_at is not null from public.businesses where slug = 'ac-plain'), true, 'the page is taken down at once');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f4a1');
select throws_ok($$ select public.publish_business((select plain from ids)) $$, 'P0001', 'suspended', 'a suspended business cannot publish itself again');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f4c1', 'aal2');
select lives_ok($$ select public.admin_set_suspension((select plain from ids), false, 'נבדק, בסדר') $$, 'an operator lifts the suspension');
select pg_temp.as_system();
select is((select published_at is null and suspended_at is null from public.businesses where slug = 'ac-plain'), true, '...the business stays unpublished until its owner publishes again');
select ok((select count(*) = 3 from public.audit_log where action in ('business.brand_approved', 'business.suspended', 'business.suspension_lifted') and business_id in (select id from public.businesses where slug in ('ac-plain', 'ac-bank'))), 'each operator action leaves a line in the audit log');

select * from finish();
rollback;
