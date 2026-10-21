-- Growth: every read policy used to call private.is_member(business_id, ...) once PER ROW. At 800k appointments (4,000 per business) the customers list took 324 ms with the
-- policy and 17 ms without it, the report ~800 ms against 14 ms; the cost grew with every appointment and would have turned into CPU (and so compute) cost.
-- The membership list is now looked up ONCE per statement: `business_id in (select private.my_business_ids('staff'))` is an uncorrelated sub-select the planner hashes.
-- Same rule as before (a row is visible when the signed-in user is a member of its business with at least that role); only the way it is evaluated changes.
-- Writes keep is_member: they touch single rows.

create function private.my_business_ids(p_min_role text default 'staff') returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.business_id from public.business_members m
  where m.user_id = (select auth.uid()) and private.role_rank(m.role) >= private.role_rank(p_min_role)
$$;
revoke all on function private.my_business_ids(text) from public, anon;
grant execute on function private.my_business_ids(text) to authenticated;

-- staff-level reads
alter policy appointments_select on public.appointments using (business_id in (select private.my_business_ids('staff')));
alter policy customers_select on public.customers using (business_id in (select private.my_business_ids('staff')));
alter policy notification_select on public.notification_log using (business_id in (select private.my_business_ids('staff')));
alter policy waitlist_entries_select on public.waitlist_entries using (business_id in (select private.my_business_ids('staff')));
alter policy waitlist_offers_select on public.waitlist_offers using (business_id in (select private.my_business_ids('staff')));
alter policy services_select on public.services using (business_id in (select private.my_business_ids('staff')));
alter policy resources_select on public.resources using (business_id in (select private.my_business_ids('staff')));
alter policy rules_select on public.availability_rules using (business_id in (select private.my_business_ids('staff')));
alter policy exceptions_select on public.availability_exceptions using (business_id in (select private.my_business_ids('staff')));
alter policy service_staff_select on public.service_staff using (business_id in (select private.my_business_ids('staff')));
alter policy subscriptions_select on public.subscriptions using (business_id in (select private.my_business_ids('staff')));
alter policy overrides_select on public.entitlement_overrides using (business_id in (select private.my_business_ids('staff')));
alter policy businesses_select_member on public.businesses using (id in (select private.my_business_ids('staff')));
-- admin-level reads
alter policy audit_select_admin on public.audit_log using (business_id is not null and business_id in (select private.my_business_ids('admin')));
alter policy redirects_select_admin on public.slug_redirects using (business_id in (select private.my_business_ids('admin')));
alter policy members_select on public.business_members using (user_id = (select auth.uid()) or business_id in (select private.my_business_ids('admin')));

-- The report: filter on the instant range (uses the (business_id, starts_at) index) instead of converting every row to a local date, and look up "first ever visit" only for the
-- customers who were active in the range (through the (business_id, customer_id, starts_at) index) instead of scanning the business's whole history. Same numbers.
create or replace function public.owner_report(p_business uuid, p_from date, p_to date) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare b public.businesses; v_rows jsonb; v_new int; v_ret int; v_from_ts timestamptz; v_to_ts timestamptz;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then raise exception 'invalid_range' using errcode = '23514'; end if;
  select * into b from public.businesses where id = p_business;
  if not found then return null; end if;                                      -- RLS: another business simply is not there
  v_from_ts := p_from::timestamp at time zone b.timezone;
  v_to_ts := (p_to + 1)::timestamp at time zone b.timezone;                   -- local midnight after the last day
  select coalesce(jsonb_agg(jsonb_build_object('date', d, 'service', s, 'status', st, 'n', n, 'cents', cents) order by d, s, st), '[]'::jsonb) into v_rows
  from (select (a.starts_at at time zone b.timezone)::date as d, a.service_snapshot->>'name' as s, a.status as st, count(*) as n, coalesce(sum(a.price_cents), 0)::bigint as cents
        from public.appointments a
        where a.business_id = p_business and a.starts_at >= v_from_ts and a.starts_at < v_to_ts
        group by 1, 2, 3) x;
  with active as (
    select distinct a.customer_id from public.appointments a
    where a.business_id = p_business and a.status not in ('pending', 'cancelled_by_customer', 'cancelled_by_business')
      and a.starts_at >= v_from_ts and a.starts_at < v_to_ts
  )
  select count(*) filter (where f.first_at >= v_from_ts), count(*) filter (where f.first_at < v_from_ts) into v_new, v_ret
  from active x
  cross join lateral (select min(a.starts_at) as first_at from public.appointments a
                      where a.business_id = p_business and a.customer_id = x.customer_id and a.status not in ('pending', 'cancelled_by_customer', 'cancelled_by_business')) f;
  return jsonb_build_object('timezone', b.timezone, 'from', p_from, 'to', p_to, 'rows', v_rows, 'newCustomers', coalesce(v_new, 0), 'returningCustomers', coalesce(v_ret, 0));
end $$;
