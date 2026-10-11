-- Stage 6: notifications (e-mail only) and jobs. System-only tables; the system key reaches them through service_role-only wrappers.

create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  type text not null check (type in ('booking_received','booking_confirmed','booking_declined','booking_cancelled_by_business','booking_cancelled_by_customer','reminder','owner_new_request','owner_customer_cancelled')),
  recipient text not null check (recipient in ('customer','owner')),
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped','dead')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  to_hash text,                                      -- HMAC of the address; the address itself is never stored here
  provider text,
  provider_message_id text,                          -- NTF-12: correlates webhooks with sends
  error text check (error is null or char_length(error) <= 500),
  skip_reason text,
  preview jsonb,                                     -- filled by the FAKE provider only (dev/CI), never in production
  bounced_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (appointment_id, type)                      -- NTF-01: one message of each kind per appointment, whatever the runners do
);
create index notification_pending_idx on public.notification_log (next_attempt_at) where status in ('queued','failed','sending');
create index notification_business_idx on public.notification_log (business_id, status, created_at);
create index notification_message_idx on public.notification_log (provider_message_id) where provider_message_id is not null;

create table public.email_suppressions (
  address_hash text primary key,
  reason text not null check (reason in ('bounce','complaint','manual')),
  created_at timestamptz not null default now()
);

alter table public.notification_log enable row level security;   alter table public.notification_log force row level security;
alter table public.email_suppressions enable row level security; alter table public.email_suppressions force row level security;

-- Owners may see THAT something went wrong (status/type), never addresses, provider ids, errors or message bodies.
create policy notification_select on public.notification_log for select to authenticated using (private.is_member(business_id, 'staff'));
grant select (id, business_id, appointment_id, type, recipient, status, skip_reason, created_at) on public.notification_log to authenticated;
grant select on public.notification_log to service_role;       -- the system path (runner, tests of the system) reads its own outbox

-- A transition is now an event too: customers hear about approvals, declines and cancellations.
create or replace function private.transition_appointment_impl(p_id uuid, p_action text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.appointments; v_to text;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into a from public.appointments where id = p_id for update;
  if not found or not private.is_member(a.business_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  v_to := case p_action when 'approve' then 'confirmed' when 'reject' then 'cancelled_by_business' when 'cancel' then 'cancelled_by_business'
                        when 'complete' then 'completed' when 'no_show' then 'no_show' when 'approve_cancellation' then 'cancelled_by_customer'
                        when 'decline_cancellation' then 'confirmed' end;
  if v_to is null then raise exception 'invalid_action' using errcode = '23514'; end if;
  if v_to = a.status then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
  if v_to in ('completed', 'no_show') and a.starts_at > now() then raise exception 'too_early' using errcode = 'P0001'; end if;
  update public.appointments set status = v_to, cancelled_at = case when v_to like 'cancelled%' then now() else cancelled_at end where id = p_id;
  perform private.audit_write(a.business_id, 'appointment.' || p_action, 'appointment', p_id::text, jsonb_build_object('from', a.status, 'to', v_to));
  if v_to in ('confirmed', 'cancelled_by_business', 'cancelled_by_customer') then
    perform private.enqueue_event(a.business_id, 'AppointmentStatusChanged', jsonb_build_object('appointmentId', p_id, 'action', p_action, 'to', v_to), 'st:' || p_id::text || ':' || p_action);
  end if;
  return jsonb_build_object('id', p_id, 'status', v_to);
end $$;

-- ------------------------------------------------------------------ private implementations (definer, system only)
create function private.notif_enqueue(p_appointment uuid, p_type text, p_recipient text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_business uuid;
begin
  select business_id into v_business from public.appointments where id = p_appointment;
  if v_business is null then return null; end if;
  insert into public.notification_log (business_id, appointment_id, type, recipient) values (v_business, p_appointment, p_type, p_recipient)
  on conflict (appointment_id, type) do nothing returning id into v_id;
  return v_id;                                      -- null = it already existed (idempotent)
end $$;

-- Claim with SKIP LOCKED: concurrent runners never take the same row. The row is leased for 5 minutes, so a crashed runner's work comes back.
create function private.notif_claim(p_limit int default 10) returns setof public.notification_log
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with picked as (
    select n.id from public.notification_log n
    where n.status in ('queued','failed','sending') and n.next_attempt_at <= now()
    order by n.next_attempt_at limit greatest(p_limit, 1)
    for update skip locked
  )
  update public.notification_log n
     set attempts = n.attempts + 1, status = 'sending', next_attempt_at = now() + interval '5 minutes'
  from picked where n.id = picked.id
  returning n.*;
end $$;

create function private.notif_context(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', n.id, 'type', n.type, 'recipient', n.recipient, 'attempts', n.attempts,
    'appointment', jsonb_build_object('id', a.id, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at, 'reference', a.reference,
                                      'serviceName', a.service_snapshot->>'name', 'location', a.location),
    'business', jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'kind', b.kind, 'timezone', b.timezone, 'phone', b.phone),
    'customer', jsonb_build_object('name', c.full_name, 'email', c.email),
    'owner', jsonb_build_object('email', (select u.email from public.business_members m join auth.users u on u.id = m.user_id
                                          where m.business_id = b.id and m.role = 'owner' order by m.created_at limit 1))
  )
  from public.notification_log n
  join public.appointments a on a.id = n.appointment_id
  join public.businesses b on b.id = n.business_id
  join public.customers c on c.id = a.customer_id
  where n.id = p_id
$$;

create function private.appointment_status(p_id uuid) returns text language sql stable security definer set search_path = '' as $$
  select status from public.appointments where id = p_id
$$;

-- outcome: sent | retry | dead | skipped
create function private.notif_finish(p_id uuid, p_outcome text, p_provider text default null, p_message_id text default null, p_error text default null,
                                     p_skip_reason text default null, p_to_hash text default null, p_preview jsonb default null, p_delay_seconds int default 60)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_outcome not in ('sent','retry','dead','skipped') then raise exception 'invalid_outcome' using errcode = '23514'; end if;
  update public.notification_log set
    status = case p_outcome when 'sent' then 'sent' when 'retry' then 'failed' when 'dead' then 'dead' else 'skipped' end,
    next_attempt_at = case when p_outcome = 'retry' then now() + make_interval(secs => greatest(p_delay_seconds, 1)) else next_attempt_at end,
    provider = coalesce(p_provider, provider), provider_message_id = coalesce(p_message_id, provider_message_id),
    error = left(p_error, 500), skip_reason = p_skip_reason, to_hash = coalesce(p_to_hash, to_hash), preview = coalesce(p_preview, preview),
    sent_at = case when p_outcome = 'sent' then now() else sent_at end
  where id = p_id and status in ('sending','queued','failed');
end $$;

create function private.notif_is_suppressed(p_hash text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.email_suppressions where address_hash = p_hash)
$$;

create function private.notif_suppress(p_hash text, p_reason text, p_message_id text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.email_suppressions (address_hash, reason) values (p_hash, p_reason) on conflict (address_hash) do nothing;
  if p_message_id is not null then update public.notification_log set bounced_at = now() where provider_message_id = p_message_id; end if;
end $$;

-- Reminders: confirmed appointments starting between p_min_lead and p_lead from p_now. One row per appointment (unique), so a re-run adds nothing.
create function private.enqueue_reminders(p_now timestamptz default now(), p_lead interval default '24 hours', p_min_lead interval default '2 hours') returns int
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  with due as (
    select a.id, a.business_id, c.email, a.created_at, a.starts_at from public.appointments a
    join public.customers c on c.id = a.customer_id
    where a.status = 'confirmed' and a.starts_at > p_now + p_min_lead and a.starts_at <= p_now + p_lead
  ), ins as (
    insert into public.notification_log (business_id, appointment_id, type, recipient, status, skip_reason)
    select d.business_id, d.id, 'reminder', 'customer',
           case when d.email is null then 'skipped' when d.created_at > d.starts_at - p_lead then 'skipped' else 'queued' end,   -- NTF-06 / NTF-02
           case when d.email is null then 'no_email' when d.created_at > d.starts_at - p_lead then 'late_booking' end
    from due d
    on conflict (appointment_id, type) do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end $$;

-- ------------------------------------------------------------------ system wrappers (service_role only)
create function public.outbox_claim(p_limit int) returns setof public.domain_events language sql security invoker set search_path = '' as $$ select * from private.claim_events(p_limit) $$;
create function public.outbox_complete(p_id uuid) returns void language sql security invoker set search_path = '' as $$ select private.complete_event(p_id) $$;
create function public.outbox_fail(p_id uuid, p_error text) returns void language sql security invoker set search_path = '' as $$ select private.fail_event(p_id, p_error) $$;
create function public.job_begin(p_job text, p_key text) returns boolean language sql security invoker set search_path = '' as $$ select private.begin_job(p_job, p_key) $$;
create function public.job_finish(p_job text, p_key text, p_error text) returns void language sql security invoker set search_path = '' as $$ select private.finish_job(p_job, p_key, p_error) $$;
create function public.notif_enqueue(p_appointment uuid, p_type text, p_recipient text) returns uuid language sql security invoker set search_path = '' as $$ select private.notif_enqueue(p_appointment, p_type, p_recipient) $$;
create function public.notif_claim(p_limit int) returns setof public.notification_log language sql security invoker set search_path = '' as $$ select * from private.notif_claim(p_limit) $$;
create function public.notif_context(p_id uuid) returns jsonb language sql stable security invoker set search_path = '' as $$ select private.notif_context(p_id) $$;
create function public.appointment_status(p_id uuid) returns text language sql stable security invoker set search_path = '' as $$ select private.appointment_status(p_id) $$;
create function public.notif_finish(p_id uuid, p_outcome text, p_provider text, p_message_id text, p_error text, p_skip_reason text, p_to_hash text, p_preview jsonb, p_delay_seconds int)
  returns void language sql security invoker set search_path = '' as $$ select private.notif_finish(p_id, p_outcome, p_provider, p_message_id, p_error, p_skip_reason, p_to_hash, p_preview, p_delay_seconds) $$;
create function public.notif_is_suppressed(p_hash text) returns boolean language sql stable security invoker set search_path = '' as $$ select private.notif_is_suppressed(p_hash) $$;
create function public.notif_suppress(p_hash text, p_reason text, p_message_id text) returns void language sql security invoker set search_path = '' as $$ select private.notif_suppress(p_hash, p_reason, p_message_id) $$;
create function public.enqueue_reminders(p_now timestamptz) returns int language sql security invoker set search_path = '' as $$ select private.enqueue_reminders(p_now) $$;

do $$
declare f text;
begin
  for f in select unnest(array[
    'private.notif_enqueue(uuid,text,text)', 'private.notif_claim(int)', 'private.notif_context(uuid)', 'private.appointment_status(uuid)',
    'private.notif_finish(uuid,text,text,text,text,text,text,jsonb,int)', 'private.notif_is_suppressed(text)', 'private.notif_suppress(text,text,text)',
    'private.enqueue_reminders(timestamptz,interval,interval)', 'private.claim_events(int)', 'private.complete_event(uuid)', 'private.fail_event(uuid,text)',
    'private.begin_job(text,text)', 'private.finish_job(text,text,text)',
    'public.outbox_claim(int)', 'public.outbox_complete(uuid)', 'public.outbox_fail(uuid,text)', 'public.job_begin(text,text)', 'public.job_finish(text,text,text)',
    'public.notif_enqueue(uuid,text,text)', 'public.notif_claim(int)', 'public.notif_context(uuid)', 'public.appointment_status(uuid)',
    'public.notif_finish(uuid,text,text,text,text,text,text,jsonb,int)', 'public.notif_is_suppressed(text)', 'public.notif_suppress(text,text,text)', 'public.enqueue_reminders(timestamptz)'
  ]) loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
