# Subscriptions look wrong / a payment webhook failed

Subscription state is changed in exactly one place: `billing_apply_event`, fed by a verified webhook (or by a platform admin). Returning from a payment page changes nothing.

1. **What did we receive?**
   ```sql
   select received_at, provider, type, outcome, occurred_at from billing_events where business_id = '<id>' order by received_at desc limit 20;
   select status, plan_id, current_period_end, grace_until, last_event_at, provider from subscriptions where business_id = '<id>';
   ```
   Outcomes: `applied`; `duplicate` (same event twice, harmless); `stale` (an older event arriving after a newer one, ignored on purpose); `unknown_business`; `invalid_plan` / `invalid_status` (the provider sent something we do not know: fix the plan mapping).
2. **No events at all** after a payment → the provider cannot reach the webhook, or the signature fails. Check the provider dashboard's delivery log; in our logs look for `billing webhook rejected` (reason `signature` = wrong secret, `invalid` = malformed payload). Re-send from the provider after fixing.
3. **Fix a business by hand** (a platform admin with MFA; recorded in the audit log, visible to the business):
   `POST /api/admin/billing/subscription` `{ businessId, planId, status, periodEnd, reason }`, or an entitlement override with an expiry: `POST /api/admin/billing/override`. Admins are added by SQL: `insert into platform_admins (user_id) values ('<auth user id>')` (the user must have MFA enrolled).
4. **Customer says "I paid and nothing changed"** → look at step 1. Tell them their bookings keep working during a grace period; never ask them to pay twice.
5. **Everything degraded at once** → check `select count(*) from subscriptions where status = 'trialing' and trial_ends_at < now()`: a batch of trials ended. That is the policy working, not a fault.

**Done when:** `subscription_state` is what the provider says, and the business sees it on `/settings/billing`.
