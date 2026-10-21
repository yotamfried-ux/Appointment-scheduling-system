-- Growth drill (docs/runbooks/db-growth-and-cost.md): 200 businesses with ~4,000 appointments each (800k appointments, 80k customers, 800k messages, ~1 GB) in the LOCAL database.
-- Seed only: triggers/foreign keys are skipped, the rows are consistent by construction. Never run against a cloud project. Remove with `npx supabase db reset`.
\timing on
set session_replication_role = replica;      -- seed only: skip triggers/FK checks (data below is consistent by construction)
begin;
-- 200 businesses, each with an owner, 3 people, 6 services, 400 customers, 4000 appointments and a message per appointment
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-0000-5ca1-' || lpad(n::text, 12, '0'))::uuid, 'authenticated', 'authenticated', 'scale-' || n || '@example.com', now(), '{}', '{}', now(), now() from generate_series(1, 200) n;
insert into public.businesses (id, slug, name, kind, created_by, published_at)
select ('00000000-0000-0000-b1b1-' || lpad(n::text, 12, '0'))::uuid, 'scale-' || n, 'עסק ' || n, 'barber', ('00000000-0000-0000-5ca1-' || lpad(n::text, 12, '0'))::uuid, now() from generate_series(1, 200) n;
insert into public.business_members (business_id, user_id, role)
select ('00000000-0000-0000-b1b1-' || lpad(n::text, 12, '0'))::uuid, ('00000000-0000-0000-5ca1-' || lpad(n::text, 12, '0'))::uuid, 'owner' from generate_series(1, 200) n;
insert into public.resources (id, business_id, name, position)
select ('00000000-0000-0000-4e50-' || lpad((n * 10 + r)::text, 12, '0'))::uuid, ('00000000-0000-0000-b1b1-' || lpad(n::text, 12, '0'))::uuid, 'איש צוות ' || r, r from generate_series(1, 200) n, generate_series(0, 2) r;
insert into public.services (id, business_id, name, duration_minutes, price_cents, position)
select ('00000000-0000-0000-5e57-' || lpad((n * 10 + s)::text, 12, '0'))::uuid, ('00000000-0000-0000-b1b1-' || lpad(n::text, 12, '0'))::uuid, 'שירות ' || s, 30, 8000, s from generate_series(1, 200) n, generate_series(0, 5) s;
insert into public.customers (id, business_id, full_name, phone)
select ('00000000-0000-0000-c057-' || lpad((n * 1000 + c)::text, 12, '0'))::uuid, ('00000000-0000-0000-b1b1-' || lpad(n::text, 12, '0'))::uuid, 'לקוח ' || c, '+9725' || lpad((n * 1000 + c)::text, 8, '0') from generate_series(1, 200) n, generate_series(0, 399) c;
-- appointments: per business 3 people x 8 half-hour slots a day, 4000 in all, from 140 days ago to about 27 days ahead (no overlaps)
insert into public.appointments (id, business_id, resource_id, service_id, customer_id, reference, status, starts_at, ends_at, blocked_until, service_snapshot, price_cents, source)
select gen_random_uuid(), ('00000000-0000-0000-b1b1-' || lpad(n::text, 12, '0'))::uuid,
  ('00000000-0000-0000-4e50-' || lpad((n * 10 + (i % 3))::text, 12, '0'))::uuid,
  ('00000000-0000-0000-5e57-' || lpad((n * 10 + (i % 6))::text, 12, '0'))::uuid,
  ('00000000-0000-0000-c057-' || lpad((n * 1000 + ((i * 7) % 400))::text, 12, '0'))::uuid,
  'SC' || n || '-' || i,
  case when (i % 17) = 0 then 'cancelled_by_customer' when (i % 29) = 0 then 'no_show' when (i / 3) / 8 < 140 then 'completed' else 'confirmed' end,
  (date_trunc('day', now()) - interval '140 days') + (((i / 3) / 8) * interval '1 day') + interval '6 hours' + (((i / 3) % 8) * interval '30 minutes'),
  (date_trunc('day', now()) - interval '140 days') + (((i / 3) / 8) * interval '1 day') + interval '6 hours' + (((i / 3) % 8) * interval '30 minutes') + interval '30 minutes',
  (date_trunc('day', now()) - interval '140 days') + (((i / 3) / 8) * interval '1 day') + interval '6 hours' + (((i / 3) % 8) * interval '30 minutes') + interval '30 minutes',
  '{"name":"שירות","durationMinutes":30,"priceCents":8000}', 8000, 'online'
from generate_series(1, 200) n, generate_series(0, 3999) i;
insert into public.notification_log (business_id, appointment_id, type, recipient, status, to_hash)
select business_id, id, 'booking_confirmed', 'customer', 'sent', md5(id::text) from public.appointments where reference like 'SC%';
commit;
analyze;
select 'appointments' t, count(*) from public.appointments union all select 'customers', count(*) from public.customers union all select 'notification_log', count(*) from public.notification_log;
select pg_size_pretty(pg_database_size(current_database())) as db_size;
