-- Strix VULN-0011 / docs/05 §5.11: a booking page lives on our own domain, so a business named after a bank or an authority could be used for phishing.
-- Three controls, none of which blocks an honest business for long:
--  1. a name screen at publication: a sensitive name is not published until an operator has looked at it (public.admin_approve_brand);
--  2. a kill switch: an operator can take a published page down at once (public.admin_set_suspension) and a suspended business cannot publish itself again;
--  3. (in the application) a "report this business" link on every booking page.
-- Both operator functions need a platform admin with a second factor, like the billing ones, and leave a line in the business's audit log.

alter table public.businesses
  add column suspended_at timestamptz,
  add column brand_reviewed_at timestamptz;
-- owners cannot write either column: only name, phone, settings and the other listed columns are granted for update.

-- Sensitive names: banks, card companies, public authorities, health funds, well-known platforms. A match does not reject the business;
-- it only holds publication until an operator approves the name. Lower-cased substring match, Hebrew and Latin.
create function private.sensitive_name(p_name text) returns boolean language sql immutable set search_path = '' as $$
  select exists (
    select 1 from unnest(array[
      'בנק', 'הפועלים', 'לאומי', 'דיסקונט', 'מזרחי טפחות', 'ישראכרט', 'כאל', 'ביטוח לאומי', 'רשות המסים', 'רשות המיסים', 'מס הכנסה',
      'משרד ה', 'ממשלת', 'משטרת ישראל', 'דואר ישראל', 'קופת חולים', 'כללית', 'מכבי שירותי', 'מאוחדת', 'צה"ל', 'עיריית', 'רשות הגנת הפרטיות',
      'bank', 'paypal', 'visa', 'mastercard', 'gov.il', 'google', 'apple', 'microsoft', 'amazon', 'facebook', 'instagram', 'whatsapp', 'tiktok'
    ]) as term where lower(coalesce(p_name, '')) like '%' || term || '%'
  )
$$;
revoke all on function private.sensitive_name(text) from public, anon, authenticated;

create or replace function private.publish_business_impl(p_business uuid) returns public.businesses
language plpgsql security definer set search_path = '' as $$
declare v_row public.businesses;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not private.is_member(p_business, 'owner') then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is not null) then
    raise exception 'email_not_verified' using errcode = 'P0001';
  end if;
  select * into v_row from public.businesses where id = p_business;
  if v_row.suspended_at is not null then raise exception 'suspended' using errcode = 'P0001'; end if;
  if v_row.published_at is null and v_row.brand_reviewed_at is null and private.sensitive_name(v_row.name) then
    raise exception 'needs_review' using errcode = 'P0001';
  end if;
  update public.businesses set published_at = coalesce(published_at, now()) where id = p_business returning * into v_row;
  perform private.audit_write(p_business, 'business.published', 'business', p_business::text);
  return v_row;
end $$;

-- Operator: approve a sensitive name after looking at the business.
create function private.admin_approve_brand_impl(p_business uuid, p_reason text) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.platform_admin_check();
  if not exists (select 1 from public.businesses where id = p_business) then raise exception 'not_found' using errcode = 'P0001'; end if;
  update public.businesses set brand_reviewed_at = now() where id = p_business;
  perform private.audit_write(p_business, 'business.brand_approved', 'business', p_business::text, jsonb_build_object('reason', p_reason));
end $$;

-- Operator: kill switch. Suspending unpublishes at once (the public pages already answer 404 for an unpublished business);
-- lifting it leaves the business unpublished, and the owner publishes again.
create function private.admin_set_suspension_impl(p_business uuid, p_suspended boolean, p_reason text) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.platform_admin_check();
  if not exists (select 1 from public.businesses where id = p_business) then raise exception 'not_found' using errcode = 'P0001'; end if;
  if p_suspended then
    update public.businesses set suspended_at = coalesce(suspended_at, now()), published_at = null where id = p_business;
  else
    update public.businesses set suspended_at = null where id = p_business;
  end if;
  perform private.audit_write(p_business, case when p_suspended then 'business.suspended' else 'business.suspension_lifted' end, 'business', p_business::text, jsonb_build_object('reason', p_reason));
end $$;

create function public.admin_approve_brand(p_business uuid, p_reason text) returns void language sql security invoker set search_path = '' as $$ select private.admin_approve_brand_impl(p_business, p_reason) $$;
create function public.admin_set_suspension(p_business uuid, p_suspended boolean, p_reason text) returns void language sql security invoker set search_path = '' as $$ select private.admin_set_suspension_impl(p_business, p_suspended, p_reason) $$;
revoke all on function private.admin_approve_brand_impl(uuid, text), private.admin_set_suspension_impl(uuid, boolean, text), public.admin_approve_brand(uuid, text), public.admin_set_suspension(uuid, boolean, text) from public, anon;
grant execute on function private.admin_approve_brand_impl(uuid, text), private.admin_set_suspension_impl(uuid, boolean, text), public.admin_approve_brand(uuid, text), public.admin_set_suspension(uuid, boolean, text) to authenticated;
