-- Auto-publish newly created businesses when the owner's email is verified and the business name is not sensitive.
create or replace function private.create_business_impl(p_name text, p_kind text, p_phone text, p_slug text, p_services jsonb, p_hours jsonb)
returns public.businesses language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_slug text := private.normalize_slug(p_slug);
  v_row public.businesses;
  v_resource uuid;
  v_publish timestamptz := null;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not private.second_factor_satisfied() then raise exception 'forbidden' using errcode = '42501'; end if;
  if (select count(*) from public.business_members where user_id = v_uid and role = 'owner') >= 3 then
    raise exception 'business_limit' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.slug_redirects where old_slug = v_slug) then
    raise exception 'slug_taken' using errcode = 'P0001';
  end if;
  if not private.sensitive_name(btrim(p_name))
     and exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    v_publish := now();
  end if;
  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;
  insert into public.businesses (slug, name, kind, phone, created_by, published_at)
  values (v_slug, btrim(p_name), p_kind, p_phone, v_uid, v_publish) returning * into v_row;
  insert into public.business_members (business_id, user_id, role) values (v_row.id, v_uid, 'owner');
  insert into public.resources (business_id, name, kind, is_default) values (v_row.id, btrim(p_name), 'business', true) returning id into v_resource;
  perform private.write_catalog(v_row.id, v_resource, p_services, p_hours);
  perform private.audit_write(v_row.id, 'business.created', 'business', v_row.id::text, jsonb_build_object('kind', p_kind));
  if v_publish is not null then
    perform private.audit_write(v_row.id, 'business.published', 'business', v_row.id::text);
  end if;
  perform private.enqueue_event(v_row.id, 'BusinessCreated', jsonb_build_object('slug', v_slug), 'created');
  return v_row;
exception when unique_violation then
  raise exception 'slug_taken' using errcode = 'P0001';
end $$;
