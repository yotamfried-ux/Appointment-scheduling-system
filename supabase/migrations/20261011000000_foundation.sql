-- Stage 0 foundation (docs/05 §5.1): default-deny database posture + schema lint.
-- Forward-only. No application tables yet (stage 2).

-- 1. Private schema for helper functions. It is NOT exposed through the Data API
--    (supabase/config.toml [api].schemas lists only public + graphql_public).
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- 2. Default deny. Supabase grants new objects in `public` to anon/authenticated by
--    default; a forgotten `enable row level security` would then expose the table.
--    Revoke those defaults so each migration must grant explicitly and deliberately.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated;

-- 3. Schema lint: returns one row per violation. Used by pgTAP (with negative controls)
--    and runnable against any environment: `select * from private.lint_violations();`
create or replace function private.lint_violations()
returns table (rule text, object_name text, detail text)
language sql
stable
set search_path = ''
as $$
  with ext_objs as (
    select objid from pg_catalog.pg_depend where deptype = 'e'
  ),
  tbl as (
    select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.oid not in (select objid from ext_objs)
  )
  -- RLS must be enabled on every public table
  select 'rls_disabled'::text, 'public.' || relname, 'ENABLE ROW LEVEL SECURITY missing'
  from tbl where not relrowsecurity
  union all
  -- ... and forced, so even the table owner is subject to policies
  select 'rls_not_forced', 'public.' || relname, 'FORCE ROW LEVEL SECURITY missing'
  from tbl where not relforcerowsecurity
  union all
  -- anon must have no table privileges at all
  select 'anon_table_grant', 'public.' || relname, 'role anon has privileges'
  from tbl
  where pg_catalog.has_table_privilege('anon', oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  union all
  -- tenant tables need a leading business_id index (docs/03 §5)
  select 'tenant_index_missing', 'public.' || t.relname, 'no index with leading business_id'
  from tbl t
  where exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = t.oid and a.attname = 'business_id' and not a.attisdropped
    )
    and not exists (
      select 1 from pg_catalog.pg_index i
      join pg_catalog.pg_attribute a2 on a2.attrelid = i.indrelid and a2.attnum = i.indkey[0]
      where i.indrelid = t.oid and a2.attname = 'business_id'
    )
  union all
  -- security definer functions must pin search_path (privilege-escalation vector)
  select 'definer_without_search_path', n.nspname || '.' || p.proname, 'SECURITY DEFINER without SET search_path'
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef and n.nspname in ('public', 'private')
    and p.oid not in (select objid from ext_objs)
    and not coalesce(exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'), false)
  union all
  -- security definer functions must not live in an API-exposed schema
  select 'definer_in_exposed_schema', n.nspname || '.' || p.proname, 'SECURITY DEFINER function in public'
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef and n.nspname = 'public' and p.oid not in (select objid from ext_objs)
  union all
  -- functions in public callable by anon become public RPCs
  select 'anon_function_execute', n.nspname || '.' || p.proname, 'role anon may EXECUTE'
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.oid not in (select objid from ext_objs)
    and pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
  union all
  -- views must run with the caller's privileges so RLS still applies
  select 'view_without_security_invoker', 'public.' || c.relname, 'view lacks security_invoker=true'
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm') and c.oid not in (select objid from ext_objs)
    and not coalesce(c.reloptions @> array['security_invoker=true'], false);
$$;

revoke all on function private.lint_violations() from public, anon, authenticated;
comment on function private.lint_violations() is
  'Security schema lint (docs/05 §5.1). Zero rows = clean. Exercised by supabase/tests/database/000_schema_lint.test.sql.';
