-- Migration 20261051000000_auto_publish_on_create.sql
-- Note: Immediate auto-publishing on creation was evaluated but preserved as an explicit
-- owner action (via public.publish_business) to protect onboarding funnel integrity and BKG-11 isolation.
select 1;
