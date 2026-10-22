-- Strix (2026-10-22): export_audit wrote an "export" line into the audit log for any admin, even on a plan without the export feature, so the log
-- could be filled with exports that never happened. It now refuses like the export itself does (plan_required) when the plan lacks the feature.
create or replace function private.export_audit_impl(p_business uuid, p_kind text, p_rows int) returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not private.is_member(p_business, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if not private.entitlement_can(p_business, 'export') then raise exception 'plan_required' using errcode = 'P0001'; end if;
  if p_kind not in ('customers', 'appointments') then raise exception 'invalid_kind' using errcode = '23514'; end if;
  perform private.audit_write(p_business, 'export.' || p_kind, 'export', p_kind, jsonb_build_object('rows', greatest(p_rows, 0)));
end $$;
