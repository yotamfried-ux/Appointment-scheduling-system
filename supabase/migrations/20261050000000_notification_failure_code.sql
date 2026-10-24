-- The owner's dashboard says WHICH message to WHICH customer failed and WHY, in words. The raw provider text (error) stays system-only;
-- owners read a coarse, derived code instead. Generated from columns the system already writes, so no writer changes and no backfill.
alter table public.notification_log add column failure_code text generated always as (
  case
    when status = 'dead' and error like 'provider 429%' then 'rate_limited'
    when status = 'dead' and error ~ '^provider 4[0-9][0-9]' and error not like 'provider 401%' and error not like 'provider 403%' and error not like 'provider 409%' then 'provider_rejected'
    when status = 'dead' then 'unknown'
    when bounced_at is not null then 'bounced'
    when status = 'skipped' and skip_reason = 'no_email' then 'no_email'
  end
) stored;

alter table public.notification_log add constraint notification_failure_code_check
  check (failure_code is null or failure_code in ('rate_limited','provider_rejected','unknown','bounced','no_email'));

-- Owners may read the code and which waitlist offer a row belongs to (for the customer's name); still not the error text, address hash or bodies.
grant select (offer_id, failure_code) on public.notification_log to authenticated;
create index notification_failure_idx on public.notification_log (business_id, created_at) where failure_code is not null;
