-- Stage 14 / B8: the owner is told by mail when the trial is about to end and when a payment failed (until now only in-app banners existed).
-- Business-level notification rows reuse notification_log.digest_date as the milestone date, so each notice is sent once per milestone.
alter table public.notification_log drop constraint notification_log_type_check;
alter table public.notification_log add constraint notification_log_type_check check (type in
  ('booking_received','booking_confirmed','booking_declined','booking_cancelled_by_business','booking_cancelled_by_customer','reminder','owner_new_request','owner_customer_cancelled',
   'waitlist_offer','waitlist_offer_expired','booking_rescheduled','owner_customer_rescheduled','owner_unconfirmed','owner_digest','booking_moved_by_business',
   'owner_trial_ending','owner_trial_last_day','owner_payment_failed'));

create or replace function private.notif_context(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', n.id, 'type', n.type, 'recipient', n.recipient, 'attempts', n.attempts,
    'appointment', case when a.id is null then null else jsonb_build_object('id', a.id, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at, 'reference', a.reference,
                                      'serviceName', a.service_snapshot->>'name', 'location', a.location) end,
    'offer', case when o.id is null then null else jsonb_build_object('id', o.id, 'status', o.status, 'slotStartsAt', o.slot_starts_at, 'expiresAt', o.expires_at,
                                      'serviceName', sv.name, 'entryId', o.entry_id) end,
    'digest', case when n.type <> 'owner_digest' or n.digest_date is null then null else jsonb_build_object('date', n.digest_date,
        'cancelledYesterday', (select count(*) from public.appointments x where x.business_id = b.id and x.status like 'cancelled%' and (x.cancelled_at at time zone b.timezone)::date = n.digest_date - 1),
        'unmarked', (select count(*) from public.appointments x where x.business_id = b.id and x.status = 'confirmed' and x.ends_at < now()),
        'tomorrow', (select count(*) from public.appointments x where x.business_id = b.id and x.status in ('pending','confirmed') and (x.starts_at at time zone b.timezone)::date = n.digest_date + 1)) end,
    'billing', case when n.type not in ('owner_trial_ending','owner_trial_last_day','owner_payment_failed') then null
                    else (select jsonb_build_object('status', sub.status, 'trialEndsAt', sub.trial_ends_at, 'graceUntil', sub.grace_until) from public.subscriptions sub where sub.business_id = b.id) end,
    'business', jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'kind', b.kind, 'timezone', b.timezone, 'phone', b.phone),
    'customer', jsonb_build_object('name', c.full_name, 'email', coalesce(a.contact_email, e.contact_email)),   -- never the customer row: that is not proof of whose address it is
    'owner', jsonb_build_object('email', (select u.email from public.business_members m join auth.users u on u.id = m.user_id
                                          where m.business_id = b.id and m.role = 'owner' order by m.created_at limit 1))
  )
  from public.notification_log n
  join public.businesses b on b.id = n.business_id
  left join public.appointments a on a.id = n.appointment_id
  left join public.waitlist_offers o on o.id = n.offer_id
  left join public.waitlist_entries e on e.id = o.entry_id
  left join public.services sv on sv.id = e.service_id
  left join public.customers c on c.id = coalesce(a.customer_id, e.customer_id)
  where n.id = p_id
$$;

create function private.enqueue_billing_notices(p_now timestamptz default now()) returns int language plpgsql security definer set search_path = '' as $$
declare v_n int := 0; v_c int;
begin
  insert into public.notification_log (business_id, type, recipient, digest_date)
  select s.business_id, 'owner_trial_ending', 'owner', (s.trial_ends_at at time zone b.timezone)::date
  from public.subscriptions s join public.businesses b on b.id = s.business_id
  where s.status = 'trialing' and b.deletion_requested_at is null and s.trial_ends_at > p_now + interval '1 day' and s.trial_ends_at <= p_now + interval '7 days'
  on conflict (business_id, digest_date, type) where digest_date is not null do nothing;
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  insert into public.notification_log (business_id, type, recipient, digest_date)
  select s.business_id, 'owner_trial_last_day', 'owner', (s.trial_ends_at at time zone b.timezone)::date
  from public.subscriptions s join public.businesses b on b.id = s.business_id
  where s.status = 'trialing' and b.deletion_requested_at is null and s.trial_ends_at > p_now and s.trial_ends_at <= p_now + interval '1 day'
  on conflict (business_id, digest_date, type) where digest_date is not null do nothing;
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  insert into public.notification_log (business_id, type, recipient, digest_date)
  select s.business_id, 'owner_payment_failed', 'owner', (s.grace_until at time zone b.timezone)::date
  from public.subscriptions s join public.businesses b on b.id = s.business_id
  where s.status = 'past_due' and b.deletion_requested_at is null and s.grace_until > p_now
  on conflict (business_id, digest_date, type) where digest_date is not null do nothing;
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  return v_n;
end $$;
revoke all on function private.enqueue_billing_notices(timestamptz) from public, anon, authenticated;
grant execute on function private.enqueue_billing_notices(timestamptz) to service_role;

create or replace function public.owner_housekeeping(p_now timestamptz default now()) returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('alerts', private.enqueue_attendance_alerts(p_now), 'autoCompleted', private.auto_complete_past(p_now), 'digests', private.enqueue_digests(p_now), 'billing', private.enqueue_billing_notices(p_now))
$$;
