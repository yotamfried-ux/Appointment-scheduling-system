-- pgTAP: B8 — the owner is told when the trial is ending and when a payment failed: once per milestone, only in the right state.
begin;
select * from no_plan();

delete from public.notification_log; delete from public.waitlist_offers; delete from public.waitlist_entries; delete from public.domain_events; delete from public.appointments;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000b1a1', 'authenticated', 'authenticated', 'b-owner@example.com', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000b1a2', 'authenticated', 'authenticated', 'b-staff@example.com', now(), '{}', '{}', now(), now());
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true); set local role service_role; end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select lives_ok($$ select public.create_business('מספרה', 'barber', null, 'bn-alpha', '[{"name":"תספורת","durationMinutes":30,"priceNis":80}]', '[{"weekday":0,"open":true,"windows":[{"from":"09:00","to":"18:00"}]}]') $$, 'owner creates a business');
select pg_temp.as_system();
update public.businesses set published_at = now() where slug = 'bn-alpha';
insert into public.business_members (business_id, user_id, role) select id, '00000000-0000-0000-0000-00000000b1a2', 'staff' from public.businesses where slug = 'bn-alpha';
create temp table ids as select (select id from public.businesses where slug = 'bn-alpha') as a, (select s.id from public.services s join public.businesses x on x.id = s.business_id where x.slug = 'bn-alpha') as s1;
grant select on ids to authenticated, service_role;


select pg_temp.as_system();
select is((select status from public.subscriptions where business_id = (select a from ids)), 'trialing', 'a new business starts in a trial');
update public.subscriptions set trial_ends_at = now() + interval '20 days' where business_id = (select a from ids);
select pg_temp.as_service();
select is(public.owner_housekeeping(now()) -> 'billing', '0', '20 days left: nothing yet');
select pg_temp.as_system();
update public.subscriptions set trial_ends_at = now() + interval '5 days' where business_id = (select a from ids);
select pg_temp.as_service();
select is(public.owner_housekeeping(now()) -> 'billing', '1', '5 days left: one notice');
select is(public.owner_housekeeping(now() + interval '1 hour') -> 'billing', '0', 'the same milestone is never sent twice');
select pg_temp.as_system();
select is((select type from public.notification_log where business_id = (select a from ids) and digest_date is not null), 'owner_trial_ending', 'it is the "ending soon" notice');
update public.subscriptions set trial_ends_at = now() + interval '10 hours' where business_id = (select a from ids);
select pg_temp.as_service();
select is(public.owner_housekeeping(now()) -> 'billing', '1', 'inside the last day: the last-day notice (a different type, so a second mail)');
select pg_temp.as_system();
select is((select count(*)::int from public.notification_log where business_id = (select a from ids) and type = 'owner_trial_last_day'), 1, 'exactly one last-day notice');
-- ... and not in other states
update public.subscriptions set status = 'active', trial_ends_at = null where business_id = (select a from ids);
delete from public.notification_log where business_id = (select a from ids);
select pg_temp.as_service();
select is(public.owner_housekeeping(now()) -> 'billing', '0', 'an active subscription gets no trial notice');
select pg_temp.as_system();
update public.subscriptions set status = 'past_due', grace_until = now() + interval '5 days' where business_id = (select a from ids);
select pg_temp.as_service();
select is(public.owner_housekeeping(now()) -> 'billing', '1', 'a failed payment (grace period) gets one notice');
select is(public.owner_housekeeping(now() + interval '2 hours') -> 'billing', '0', 'and not again for the same grace period');
select pg_temp.as_system();
update public.subscriptions set grace_until = now() - interval '1 day' where business_id = (select a from ids);
delete from public.notification_log where business_id = (select a from ids);
select pg_temp.as_service();
select is(public.owner_housekeeping(now()) -> 'billing', '0', 'after the grace period ended there is nothing to warn about');
select pg_temp.as_system();
update public.subscriptions set status = 'trialing', trial_ends_at = now() + interval '3 days' where business_id = (select a from ids);
update public.businesses set deletion_requested_at = now(), deletion_scheduled_for = now() + interval '14 days', published_before_deletion = published_at, published_at = null where id = (select a from ids);
select pg_temp.as_service();
select is(public.owner_housekeeping(now()) -> 'billing', '0', 'a business that is being deleted is not nagged');
select pg_temp.as_user('00000000-0000-0000-0000-00000000b1a1');
select throws_ok($$ select private.enqueue_billing_notices(now()) $$, '42501', null, 'an owner cannot run the job');
select pg_temp.as_system();
select is((select count(*)::int from private.lint_violations()), 0, 'schema lint stays empty');
select * from finish();
rollback;
