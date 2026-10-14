-- Stage 12 / ACC-09: the owner can export everything the business holds, and delete the account with a grace period.
-- Deletion: request (owner only) ⇒ the booking page closes, future appointments and waitlist entries are cancelled and customers are told (the normal cancellation mail),
-- the owner can cancel the request for 14 days; then a job removes the business and everything under it. Audit rows are kept (they carry no personal data).
alter table public.businesses
  add column deletion_requested_at timestamptz,
  add column deletion_scheduled_for timestamptz,
  add column published_before_deletion timestamptz,
  add constraint businesses_deletion_pair check ((deletion_requested_at is null) = (deletion_scheduled_for is null));

-- a business waiting for deletion cannot be re-published by any path (the publish RPC included)
create function private.businesses_no_publish_while_deleting() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.deletion_requested_at is not null and new.published_at is not null and (tg_op = 'INSERT' or old.published_at is null) then
    raise exception 'deletion_pending' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger businesses_no_publish_while_deleting before insert or update on public.businesses for each row execute function private.businesses_no_publish_while_deleting();

create function private.request_business_deletion_impl(p_business uuid, p_confirm_name text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.businesses; a record; v_cancelled int := 0; v_wl int;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into b from public.businesses where id = p_business for update;
  if not found or not private.is_member(p_business, 'owner') then raise exception 'forbidden' using errcode = '42501'; end if;
  if b.deletion_requested_at is not null then return jsonb_build_object('outcome', 'already', 'scheduledFor', b.deletion_scheduled_for); end if;
  if btrim(coalesce(p_confirm_name, '')) <> b.name then raise exception 'confirmation_mismatch' using errcode = 'P0001'; end if;
  update public.businesses set deletion_requested_at = now(), deletion_scheduled_for = now() + interval '14 days', published_before_deletion = b.published_at, published_at = null where id = p_business;
  for a in select id from public.appointments where business_id = p_business and starts_at > now() and status in ('pending', 'confirmed', 'cancellation_requested') order by starts_at loop
    update public.appointments set status = 'cancelled_by_business', cancelled_at = now() where id = a.id;
    perform private.enqueue_event(p_business, 'AppointmentStatusChanged', jsonb_build_object('appointmentId', a.id, 'action', 'cancel', 'to', 'cancelled_by_business'), 'st:' || a.id::text || ':cancel');
    v_cancelled := v_cancelled + 1;
  end loop;
  update public.waitlist_entries set status = 'cancelled' where business_id = p_business and status in ('waiting', 'offered');
  get diagnostics v_wl = row_count;
  perform private.audit_write(p_business, 'account.deletion_requested', 'business', p_business::text, jsonb_build_object('appointmentsCancelled', v_cancelled, 'waitlistClosed', v_wl));
  return jsonb_build_object('outcome', 'requested', 'scheduledFor', now() + interval '14 days', 'appointmentsCancelled', v_cancelled);
end $$;

create function private.cancel_business_deletion_impl(p_business uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.businesses;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into b from public.businesses where id = p_business for update;
  if not found or not private.is_member(p_business, 'owner') then raise exception 'forbidden' using errcode = '42501'; end if;
  if b.deletion_requested_at is null then return jsonb_build_object('outcome', 'not_pending'); end if;
  update public.businesses set deletion_requested_at = null, deletion_scheduled_for = null, published_at = b.published_before_deletion, published_before_deletion = null where id = p_business;
  perform private.audit_write(p_business, 'account.deletion_cancelled', 'business', p_business::text, '{}');
  return jsonb_build_object('outcome', 'cancelled');   -- appointments cancelled by the request stay cancelled: the customers were already told
end $$;

-- everything the business holds, as one JSON document (owner only; the export itself is audited)
create function private.owner_export_account_impl(p_business uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not private.is_member(p_business, 'owner') then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'exportedAt', now(), 'format', 'easylife-account-export/1',
    'business', (select to_jsonb(b) - 'created_by' - 'deletion_requested_at' - 'deletion_scheduled_for' - 'published_before_deletion' from public.businesses b where b.id = p_business),
    'services', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at) from public.services s where s.business_id = p_business), '[]'),
    'availabilityRules', coalesce((select jsonb_agg(to_jsonb(x)) from public.availability_rules x where x.business_id = p_business), '[]'),
    'availabilityExceptions', coalesce((select jsonb_agg(to_jsonb(x)) from public.availability_exceptions x where x.business_id = p_business), '[]'),
    'customers', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'fullName', c.full_name, 'phone', c.phone, 'email', c.email, 'notes', c.notes, 'createdAt', c.created_at, 'anonymizedAt', c.anonymized_at) order by c.created_at) from public.customers c where c.business_id = p_business), '[]'),
    'appointments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'reference', a.reference, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at, 'customerId', a.customer_id, 'contactEmail', a.contact_email,
        'service', a.service_snapshot, 'priceCents', a.price_cents, 'currency', a.currency, 'source', a.source, 'location', a.location, 'ownerNote', a.owner_note, 'createdAt', a.created_at) order by a.starts_at) from public.appointments a where a.business_id = p_business), '[]'),
    'waitlist', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'status', w.status, 'onDate', w.on_date, 'customerId', w.customer_id, 'createdAt', w.created_at) order by w.created_at) from public.waitlist_entries w where w.business_id = p_business), '[]'),
    'members', coalesce((select jsonb_agg(jsonb_build_object('userId', m.user_id, 'role', m.role)) from public.business_members m where m.business_id = p_business), '[]'),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('at', l.created_at, 'action', l.action, 'entity', l.entity, 'entityId', l.entity_id) order by l.created_at) from public.audit_log l where l.business_id = p_business), '[]')
  ) into r;
  perform private.audit_write(p_business, 'account.export', 'business', p_business::text, '{}');
  return r;
end $$;

-- the job: remove businesses whose grace period has ended (system path only)
create function private.purge_deleted_businesses_impl(p_now timestamptz default now()) returns int language plpgsql security definer set search_path = '' as $$
declare b record; v_n int := 0;
begin
  for b in select id from public.businesses where deletion_scheduled_for is not null and deletion_scheduled_for <= p_now for update skip locked loop
    perform private.audit_write(b.id, 'account.purged', 'business', b.id::text, '{}');
    delete from public.businesses where id = b.id;          -- cascades to everything under the business
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create function public.request_business_deletion(p_business uuid, p_confirm_name text) returns jsonb language sql security invoker set search_path = '' as $$ select private.request_business_deletion_impl(p_business, p_confirm_name) $$;
create function public.cancel_business_deletion(p_business uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.cancel_business_deletion_impl(p_business) $$;
create function public.owner_export_account(p_business uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.owner_export_account_impl(p_business) $$;
create function public.purge_deleted_businesses(p_now timestamptz default now()) returns int language sql security invoker set search_path = '' as $$ select private.purge_deleted_businesses_impl(p_now) $$;
revoke all on function private.request_business_deletion_impl(uuid, text), private.cancel_business_deletion_impl(uuid), private.owner_export_account_impl(uuid), private.purge_deleted_businesses_impl(timestamptz),
  public.request_business_deletion(uuid, text), public.cancel_business_deletion(uuid), public.owner_export_account(uuid), public.purge_deleted_businesses(timestamptz) from public, anon, authenticated;
grant execute on function private.request_business_deletion_impl(uuid, text), private.cancel_business_deletion_impl(uuid), private.owner_export_account_impl(uuid),
  public.request_business_deletion(uuid, text), public.cancel_business_deletion(uuid), public.owner_export_account(uuid) to authenticated;
grant execute on function private.purge_deleted_businesses_impl(timestamptz), public.purge_deleted_businesses(timestamptz) to service_role;
