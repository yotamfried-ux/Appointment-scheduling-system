-- Stage 13 / ACC-09: the purge also removes the owner's sign-in identity when nothing else keeps it (limitation recorded in stage 12).
create or replace function private.purge_deleted_businesses_impl(p_now timestamptz default now()) returns int language plpgsql security definer set search_path = '' as $$
declare b record; v_n int := 0; v_users uuid[];
begin
  for b in select id from public.businesses where deletion_scheduled_for is not null and deletion_scheduled_for <= p_now for update skip locked loop
    perform private.audit_write(b.id, 'account.purged', 'business', b.id::text, '{}');
    select coalesce(array_agg(user_id), '{}') into v_users from public.business_members where business_id = b.id;
    delete from public.businesses where id = b.id;          -- cascades to everything under the business
    -- the sign-in identities of the people who only belonged to this business go too (ACC-09: nothing of them is kept); anyone who also belongs to another business, or is a platform admin, stays
    delete from auth.users u where u.id = any (v_users)
      and not exists (select 1 from public.business_members m where m.user_id = u.id)
      and not exists (select 1 from public.platform_admins p where p.user_id = u.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
