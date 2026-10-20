-- Retention (owner decision 2026-10-20): personal details of a customer are kept for 3 years after the customer's last activity, then removed the same way an owner's "delete personal details" does.
-- Last activity = the latest of: the customer's newest appointment start, newest waitlist day, and the day the customer was created. Appointment facts stay without identity so the business's reports stay true.
-- System path only (service_role). Idempotent: an anonymised customer is skipped.

create function private.retention_anonymize_impl(p_now timestamptz default now()) returns int language plpgsql security definer set search_path = '' as $$
declare c record; v_phone text; v_tries int; v_n int := 0;
begin
  for c in
    select cu.id, cu.business_id from public.customers cu
    where cu.anonymized_at is null
      and greatest(
            cu.created_at,
            coalesce((select max(a.starts_at) from public.appointments a where a.customer_id = cu.id), cu.created_at),
            coalesce((select max(w.on_date)::timestamptz from public.waitlist_entries w where w.customer_id = cu.id), cu.created_at)
          ) < p_now - interval '3 years'
      and not exists (select 1 from public.appointments a where a.customer_id = cu.id and a.status in ('pending', 'confirmed', 'cancellation_requested') and a.starts_at > p_now)
    for update of cu skip locked
  loop
    update public.waitlist_entries set status = 'cancelled' where customer_id = c.id and status in ('waiting', 'offered');
    perform set_config('app.anonymizing', 'on', true);
    update public.appointments set intake = '{}'::jsonb, owner_note = null, contact_email = null where customer_id = c.id;
    update public.waitlist_entries set contact_email = null where customer_id = c.id;
    v_tries := 0;
    loop
      v_phone := '+999' || lpad((('x' || substr(md5(c.id::text || v_tries::text), 1, 8))::bit(32)::bigint)::text, 10, '0');
      begin
        update public.customers set full_name = 'לקוח שנמחק', phone = v_phone, email = null, notes = null, anonymized_at = p_now where id = c.id;
        exit;
      exception when unique_violation then
        v_tries := v_tries + 1;
        if v_tries > 5 then raise; end if;
      end;
    end loop;
    perform set_config('app.anonymizing', 'off', true);
    perform private.audit_write(c.business_id, 'customer.retention_anonymize', 'customer', c.id::text, jsonb_build_object('rule', '3y_after_last_activity'));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create function public.retention_anonymize(p_now timestamptz default now()) returns int language sql security invoker set search_path = '' as $$ select private.retention_anonymize_impl(p_now) $$;
revoke all on function private.retention_anonymize_impl(timestamptz), public.retention_anonymize(timestamptz) from public, anon, authenticated;
grant execute on function private.retention_anonymize_impl(timestamptz), public.retention_anonymize(timestamptz) to service_role;
