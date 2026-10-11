-- pgTAP: schema lint (docs/05 §5.1, scenarios SEC-03 / SEC-14).
-- Negative controls: every rule must FIRE on a deliberately bad object, otherwise a
-- vacuously-green lint (zero tables today) would prove nothing.
begin;
select plan(14);

-- Baseline
select is_empty(
  $$ select * from private.lint_violations() $$,
  'baseline: a fresh database has zero schema-lint violations'
);

-- Privilege posture of the helper schema and function
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon cannot use schema private');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated cannot use schema private');
select ok(not has_function_privilege('anon', 'private.lint_violations()', 'EXECUTE'), 'anon cannot execute the lint function');
select ok(not has_function_privilege('authenticated', 'private.lint_violations()', 'EXECUTE'), 'authenticated cannot execute the lint function');

-- Default privileges are deny-by-default: a table created now is NOT readable by anon.
create table public.lint_probe_default (id int, business_id uuid);
select ok(not has_table_privilege('anon', 'public.lint_probe_default', 'SELECT'), 'new tables are not granted to anon by default');
select ok(not has_table_privilege('authenticated', 'public.lint_probe_default', 'SELECT'), 'new tables are not granted to authenticated by default');
drop table public.lint_probe_default;

-- Negative controls: each rule fires for the right object, for the right reason.
create table public.lint_bad_no_rls (id int, business_id uuid);
select ok(
  exists (select 1 from private.lint_violations() where rule = 'rls_disabled' and object_name = 'public.lint_bad_no_rls'),
  'rule rls_disabled fires for a table without RLS'
);
select ok(
  exists (select 1 from private.lint_violations() where rule = 'tenant_index_missing' and object_name = 'public.lint_bad_no_rls'),
  'rule tenant_index_missing fires for a business_id table without a leading index'
);

alter table public.lint_bad_no_rls enable row level security;
select ok(
  exists (select 1 from private.lint_violations() where rule = 'rls_not_forced' and object_name = 'public.lint_bad_no_rls'),
  'rule rls_not_forced fires when RLS is enabled but not forced'
);

grant select on public.lint_bad_no_rls to anon;
select ok(
  exists (select 1 from private.lint_violations() where rule = 'anon_table_grant' and object_name = 'public.lint_bad_no_rls'),
  'rule anon_table_grant fires when anon is granted access'
);

create function public.lint_bad_definer() returns int language sql security definer as $$ select 1 $$;
select ok(
  exists (select 1 from private.lint_violations() where rule = 'definer_without_search_path' and object_name = 'public.lint_bad_definer')
  and exists (select 1 from private.lint_violations() where rule = 'definer_in_exposed_schema' and object_name = 'public.lint_bad_definer'),
  'rules definer_without_search_path and definer_in_exposed_schema fire for an unsafe SECURITY DEFINER function in public'
);

grant execute on function public.lint_bad_definer() to anon;
select ok(
  exists (select 1 from private.lint_violations() where rule = 'anon_function_execute' and object_name = 'public.lint_bad_definer'),
  'rule anon_function_execute fires when anon may execute a public function'
);

create view public.lint_bad_view as select 1 as x;
select ok(
  exists (select 1 from private.lint_violations() where rule = 'view_without_security_invoker' and object_name = 'public.lint_bad_view'),
  'rule view_without_security_invoker fires for a plain view'
);

select * from finish();
rollback;
