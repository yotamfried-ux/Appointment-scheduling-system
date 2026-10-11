-- pgTAP: tenancy core (docs/05 §5.1, scenarios ACC-01/04/06/07, SEC-01/02, outbox, jobs, rate limit).
-- Every RLS claim has: member / non-member / removed member / anon / other business, plus a NEGATIVE CONTROL
-- (RLS temporarily disabled ⇒ the same query leaks, proving the tests can fail for the right reason).
begin;
select * from no_plan();

-- ---------- fixtures (as postgres, which bypasses RLS) ----------
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'owner-a@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'admin-a@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000a3', 'authenticated', 'authenticated', 'staff-a@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'owner-b@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'unverified@example.com', null, '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated', 'outsider@example.com', now(), '{}', '{}', now(), now());

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

-- Business A (owner a1) created through the real RPC; then members added by the system.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.create_business('מספרת אלפא', 'barber', '+972501234567', 'alpha-salon', '[{"name":"שירות","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"17:00"}]}]') $$, 'ACC-01: owner creates a business through the RPC');
select pg_temp.as_system();
insert into public.business_members (business_id, user_id, role)
select id, '00000000-0000-0000-0000-0000000000a2', 'admin' from public.businesses where slug = 'alpha-salon';
insert into public.business_members (business_id, user_id, role)
select id, '00000000-0000-0000-0000-0000000000a3', 'staff' from public.businesses where slug = 'alpha-salon';

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.create_business('בטא', 'clinic', null, 'beta-clinic', '[{"name":"שירות","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"17:00"}]}]') $$, 'owner B creates business B');
select pg_temp.as_system();

create temp table ids as
  select (select id from public.businesses where slug = 'alpha-salon') as a, (select id from public.businesses where slug = 'beta-clinic') as b;
grant select on ids to authenticated, anon;

-- ---------- ACC-01: atomic creation ----------
select is((select count(*)::int from public.business_members where business_id = (select a from ids) and role = 'owner'), 1, 'ACC-01: exactly one owner membership was created');
select is((select count(*)::int from public.audit_log where business_id = (select a from ids) and action = 'business.created'), 1, 'ACC-01: creation is audited');
select is((select count(*)::int from public.domain_events where business_id = (select a from ids) and type = 'BusinessCreated'), 1, 'ACC-01: BusinessCreated is in the outbox');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 1, 'ACC-01: profile exists');

-- failure leaves nothing behind (no half-created business)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$ select public.create_business('x', 'barber', null, 'bad-name', '[{"name":"שירות","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"17:00"}]}]') $$, '23514', null, 'name shorter than 2 characters is rejected');
select throws_ok($$ select public.create_business('עסק', 'plumber', null, 'okay-slug', '[{"name":"שירות","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"17:00"}]}]') $$, '23514', null, 'unknown business kind is rejected');
select throws_ok($$ select public.create_business('עסק', 'barber', '050-123', 'okay-slug', '[{"name":"שירות","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"17:00"}]}]') $$, '23514', null, 'ACC-03: phone must be E.164');
select throws_ok($$ select public.create_business('עסק', 'barber', null, 'admin', '[{"name":"שירות","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"17:00"}]}]') $$, '23514', null, 'ACC-06: reserved slug rejected');
select throws_ok($$ select public.create_business('עסק', 'barber', null, 'שלום', '[{"name":"שירות","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"17:00"}]}]') $$, '23514', null, 'ACC-06: non-ASCII slug rejected');
select throws_ok($$ select public.create_business('עסק', 'barber', null, 'a--b', '[{"name":"שירות","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"17:00"}]}]') $$, '23514', null, 'ACC-06: malformed slug rejected');
select throws_ok($$ select public.create_business('עסק', 'barber', null, 'Alpha-Salon', '[{"name":"שירות","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"17:00"}]}]') $$, 'P0001', 'slug_taken', 'ACC-06: slug uniqueness is case-insensitive');
select pg_temp.as_system();
select is((select count(*)::int from public.business_members where user_id = '00000000-0000-0000-0000-0000000000d1'), 0, 'rollback: failed creations left no membership');
select is((select count(*)::int from public.audit_log where actor_id = '00000000-0000-0000-0000-0000000000d1'), 0, 'rollback: failed creations left no audit rows');

select pg_temp.as_anon();
select throws_ok($$ select public.create_business('עסק', 'barber', null, 'anon-try', '[{"name":"שירות","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"17:00"}]}]') $$, '42501', null, 'anon cannot call create_business');
select pg_temp.as_system();

-- limit of 3 businesses per owner
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select lives_ok($$ select public.create_business('אחד', 'other', null, 'one-biz', '[{"name":"שירות","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"17:00"}]}]') $$, 'first business');
select lives_ok($$ select public.create_business('שניים', 'other', null, 'two-biz', '[{"name":"שירות","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"17:00"}]}]') $$, 'second business');
select lives_ok($$ select public.create_business('שלושה', 'other', null, 'three-biz', '[{"name":"שירות","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"17:00"}]}]') $$, 'third business');
select throws_ok($$ select public.create_business('ארבעה', 'other', null, 'four-biz', '[{"name":"שירות","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"17:00"}]}]') $$, 'P0001', 'business_limit', 'fourth business is refused');
select pg_temp.as_system();
delete from public.businesses where slug in ('one-biz', 'two-biz', 'three-biz');

-- ---------- SEC-01: row level security ----------
select pg_temp.as_anon();
select throws_ok($$ select * from public.businesses $$, '42501', null, 'anon cannot read businesses');
select throws_ok($$ select * from public.business_members $$, '42501', null, 'anon cannot read memberships');
select pg_temp.as_system();

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.businesses), 1, 'owner A sees only business A');
select is((select count(*)::int from public.businesses where id = (select b from ids)), 0, 'SEC-01: owner A cannot see business B by id');
select is((select count(*)::int from public.business_members), 3, 'owner A sees all members of A');
select pg_temp.as_system();

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.businesses), 1, 'staff can read their business');
select is((select count(*)::int from public.business_members), 1, 'staff sees only their own membership row');
update public.businesses set name = 'hacked by staff' where id = (select a from ids);
select pg_temp.as_system();
select is((select name from public.businesses where id = (select a from ids)), 'מספרת אלפא', 'staff cannot update the business (0 rows)');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
update public.businesses set name = 'שם חדש' where id = (select a from ids);
select pg_temp.as_system();
select is((select name from public.businesses where id = (select a from ids)), 'שם חדש', 'admin can update name');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ update public.businesses set slug = 'sneaky' where id = (select a from ids) $$, '42501', null, 'SEC-02: slug cannot be changed with a direct update');
select throws_ok($$ update public.businesses set kind = 'clinic' where id = (select a from ids) $$, '42501', null, 'kind is immutable from the client');
select throws_ok($$ update public.businesses set published_at = now() where id = (select a from ids) $$, '42501', null, 'published_at cannot be set directly');
select throws_ok($$ update public.businesses set created_by = '00000000-0000-0000-0000-0000000000a2' where id = (select a from ids) $$, '42501', null, 'created_by cannot be changed');
select pg_temp.as_system();

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from public.businesses), 0, 'outsider sees nothing');
update public.businesses set name = 'pwned' where id = (select a from ids);
select pg_temp.as_system();
select is((select name from public.businesses where id = (select a from ids)), 'שם חדש', 'outsider update of another tenant changes 0 rows');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
update public.businesses set name = 'pwned' where id = (select b from ids);
select throws_ok($$ insert into public.businesses (slug, name, kind, created_by) values ('direct-insert', 'ישיר', 'other', '00000000-0000-0000-0000-0000000000a1') $$, '42501', null, 'direct INSERT into businesses is not allowed (RPC only)');
select throws_ok($$ insert into public.business_members (business_id, user_id, role) values ((select b from ids), '00000000-0000-0000-0000-0000000000a1', 'owner') $$, '42501', null, 'SEC-02: a user cannot add themselves to another business');
select throws_ok($$ insert into public.domain_events (business_id, type) values ((select a from ids), 'x') $$, '42501', null, 'domain_events: no direct writes');
select throws_ok($$ select * from public.domain_events $$, '42501', null, 'domain_events: no direct reads');
select throws_ok($$ select * from public.job_runs $$, '42501', null, 'job_runs: system only');
select throws_ok($$ select * from public.rate_counters $$, '42501', null, 'rate_counters: system only');
select throws_ok($$ select private.enqueue_event((select a from ids), 'x') $$, '42501', null, 'private.enqueue_event is not callable by authenticated');
select pg_temp.as_system();
select is((select name from public.businesses where id = (select b from ids)), 'בטא', 'cross-tenant update changed 0 rows');

-- removed member loses access immediately (role is read from the table, not the JWT)
delete from public.business_members where user_id = '00000000-0000-0000-0000-0000000000a3';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.businesses), 0, 'removed staff member sees nothing, with the same JWT');
select pg_temp.as_system();

-- NEGATIVE CONTROL: with RLS off, the outsider DOES see data. The tests above can therefore fail.
alter table public.businesses disable row level security;
alter table public.businesses no force row level security;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select cmp_ok((select count(*)::int from public.businesses), '>', 0, 'negative control: RLS disabled ⇒ outsider sees rows (leak detected)');
select pg_temp.as_system();
alter table public.businesses enable row level security;
alter table public.businesses force row level security;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from public.businesses), 0, 'negative control reverted: outsider sees nothing again');
select pg_temp.as_system();

-- audit log is append-only even for the table owner
select throws_ok($$ update public.audit_log set action = 'x' $$, 'P0001', 'audit_log is append-only', 'audit_log cannot be updated');
select throws_ok($$ delete from public.audit_log $$, 'P0001', 'audit_log is append-only', 'audit_log cannot be deleted');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select cmp_ok((select count(*)::int from public.audit_log), '>=', 1, 'owner can read the audit log of their business');
select is((select count(*)::int from public.audit_log where business_id = (select b from ids)), 0, 'owner A cannot read the audit log of business B');
select pg_temp.as_system();

-- ---------- ACC-07: slug changes and redirects ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.change_business_slug((select a from ids), 'admin-new') $$, '42501', null, 'only an owner can change the slug');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$ select public.change_business_slug((select a from ids), 'outsider-new') $$, '42501', null, 'an outsider cannot change another business slug');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.change_business_slug((select a from ids), 'alpha-two') $$, 'owner changes slug');
select lives_ok($$ select public.change_business_slug((select a from ids), 'alpha-three') $$, 'owner changes slug again');
select throws_ok($$ select public.change_business_slug((select a from ids), 'admin') $$, '23514', null, 'a reserved slug cannot be used as a new slug');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.change_business_slug((select b from ids), 'alpha-salon') $$, 'P0001', 'slug_taken', 'ACC-07: another business cannot take an old slug of A');
select throws_ok($$ select public.change_business_slug((select b from ids), 'alpha-two') $$, 'P0001', 'slug_taken', 'ACC-07: ...nor any older one');
select pg_temp.as_system();
select is((select canonical_slug from private.resolve_slug('alpha-salon')), 'alpha-three', 'oldest slug resolves straight to the current slug (no chain)');
select is((select redirected from private.resolve_slug('alpha-two')), true, 'intermediate slug redirects');
select is((select redirected from private.resolve_slug('alpha-three')), false, 'current slug does not redirect');
select is((select count(*)::int from private.resolve_slug('nope-nope')), 0, 'unknown slug resolves to nothing');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.change_business_slug((select a from ids), 'alpha-salon') $$, 'taking back an old slug of our own is allowed (cycle)');
select pg_temp.as_system();
select is((select redirected from private.resolve_slug('alpha-salon')), false, 'cycle: the live slug wins; its redirect row was removed');
select is((select count(*)::int from public.slug_redirects where old_slug = 'alpha-salon'), 0, 'no redirect shadows a live slug');
select is((select canonical_slug from private.resolve_slug('alpha-three')), 'alpha-salon', 'cycle: previous slugs still resolve to the live one');
select ok(not has_function_privilege('authenticated', 'private.resolve_slug(text)', 'EXECUTE'), 'resolve_slug is system-only');
select ok(has_function_privilege('service_role', 'private.resolve_slug(text)', 'EXECUTE'), 'resolve_slug is callable by service_role');

-- slug availability: uniform boolean + rate limit (ACC-02 spirit, SEC-07)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select is((select public.slug_available('fresh-slug')), true, 'a free slug is available');
select is((select public.slug_available('alpha-salon')), false, 'a taken slug is unavailable');
select is((select public.slug_available('alpha-two')), false, 'an old (redirected) slug is unavailable');
select is((select public.slug_available('admin')), false, 'a reserved slug is unavailable');
select is((select public.slug_available('bad slug!')), false, 'an invalid slug is unavailable');
select pg_temp.as_anon();
select throws_ok($$ select public.slug_available('x-y-z') $$, '42501', null, 'anon cannot probe slugs');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
do $$ begin for i in 1..25 loop perform public.slug_available('probe-' || i); end loop; end $$;
select throws_ok($$ select public.slug_available('one-more') $$, 'P0001', 'rate_limited', 'SEC-07: slug probing is rate limited per user');
select pg_temp.as_system();

-- ---------- ACC-04: publish needs a verified email ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select public.create_business('לא מאומת', 'other', null, 'unverified-biz', '[{"name":"שירות","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"17:00"}]}]') $$, 'an unverified user can create (onboard) a business');
select throws_ok($$ select public.publish_business((select id from public.businesses where slug = 'unverified-biz')) $$, 'P0001', 'email_not_verified', 'ACC-04: unverified owner cannot publish');
select pg_temp.as_system();
select is((select published_at from public.businesses where slug = 'unverified-biz'), null, 'still unpublished');
update auth.users set email_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select public.publish_business((select id from public.businesses where slug = 'unverified-biz')) $$, 'verified owner can publish');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.publish_business((select a from ids)) $$, '42501', null, 'only an owner can publish');
select pg_temp.as_system();
select isnt((select published_at from public.businesses where slug = 'unverified-biz'), null, 'published_at is set');

-- ---------- outbox, jobs, rate counters ----------
select pg_temp.as_system();
select is(private.enqueue_event((select a from ids), 'T', '{}', 'k1'), private.enqueue_event((select a from ids), 'T', '{}', 'k1'), 'outbox: same dedupe key returns the same event');
select is((select count(*)::int from public.domain_events where dedupe_key = 'k1'), 1, 'outbox: dedupe key stores one row');
select is((select count(*)::int from private.claim_events(100000) where dedupe_key = 'k1'), 1, 'outbox: pending event is claimed');
select is((select count(*)::int from private.claim_events(100000) where dedupe_key = 'k1'), 0, 'outbox: a claimed event is hidden during backoff (no double processing)');
select is((select attempts from public.domain_events where dedupe_key = 'k1'), 1, 'outbox: attempts are counted');
update public.domain_events set available_at = now() where dedupe_key = 'k1';
select private.complete_event((select id from public.domain_events where dedupe_key = 'k1'));
select is((select count(*)::int from private.claim_events(100000) where dedupe_key = 'k1'), 0, 'outbox: a completed event is never claimed again');

select is(private.begin_job('reminders', '2026-10-14T09'), true, 'job: first caller owns the run');
select is(private.begin_job('reminders', '2026-10-14T09'), false, 'job: a concurrent/duplicate caller does not run it again');
select private.finish_job('reminders', '2026-10-14T09', 'boom');
select is((select status from public.job_runs where run_key = '2026-10-14T09'), 'failed', 'job: failure is recorded');
select is(private.begin_job('reminders', '2026-10-14T09'), true, 'job: a failed run can be retried');
select private.finish_job('reminders', '2026-10-14T09');
select is(private.begin_job('reminders', '2026-10-14T09'), false, 'job: a succeeded run is never repeated');

select is((select allowed from private.rate_limit_hit('ip:1.2.3.4', 60, 2)), true, 'rate limit: hit 1 allowed');
select is((select allowed from private.rate_limit_hit('ip:1.2.3.4', 60, 2)), true, 'rate limit: hit 2 allowed');
select is((select allowed from private.rate_limit_hit('ip:1.2.3.4', 60, 2)), false, 'rate limit: hit 3 blocked');
select ok((select retry_after between 1 and 60 from private.rate_limit_hit('ip:1.2.3.4', 60, 2)), 'rate limit: Retry-After is within the window');
select is((select allowed from private.rate_limit_hit('ip:5.6.7.8', 60, 2)), true, 'rate limit: other keys are independent');

-- Everything above must leave the database lint-clean.
select is_empty($$ select * from private.lint_violations() $$, 'schema lint is clean after the stage 2 migration');

select * from finish();
rollback;
