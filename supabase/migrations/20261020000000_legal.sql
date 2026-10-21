-- Stage 10: versioned acceptance of the terms and the privacy policy (CMP-03), and the "last changed" instant of an appointment (for a monotonic ICS SEQUENCE, CAL-05).
-- No external-calendar tables: calendars are not synchronised (decision D23).

create or replace function private.public_get_appointment(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'reference', a.reference, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at,
    'serviceName', a.service_snapshot->>'name', 'priceCents', a.price_cents, 'businessName', b.name, 'businessSlug', b.slug, 'timezone', b.timezone,
    'cancelUntil', a.starts_at - make_interval(hours => b.cancel_until_hours), 'updatedAt', a.updated_at)
  from public.appointments a join public.businesses b on b.id = a.business_id where a.id = p_id
$$;

create table public.legal_acceptances (
  user_id uuid not null references auth.users (id) on delete cascade,
  doc text not null check (doc in ('terms', 'privacy')),
  version text not null check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]+)?$'),
  accepted_at timestamptz not null default now(),
  primary key (user_id, doc, version)
);
alter table public.legal_acceptances enable row level security;
alter table public.legal_acceptances force row level security;
create policy legal_acceptances_select on public.legal_acceptances for select to authenticated using (user_id = (select auth.uid()));
create policy legal_acceptances_insert on public.legal_acceptances for insert to authenticated with check (user_id = (select auth.uid()));
grant select on public.legal_acceptances to authenticated;
grant insert (user_id, doc, version) on public.legal_acceptances to authenticated;     -- append-only: nobody can edit or delete a recorded acceptance

create function public.accept_legal(p_doc text, p_version text) returns void language sql security invoker set search_path = '' as $$
  insert into public.legal_acceptances (user_id, doc, version) values ((select auth.uid()), p_doc, p_version) on conflict do nothing
$$;
revoke all on function public.accept_legal(text, text) from public, anon;
grant execute on function public.accept_legal(text, text) to authenticated;
