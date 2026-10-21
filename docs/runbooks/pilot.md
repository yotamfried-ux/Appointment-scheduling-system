# Closed pilot: first real business (2026-10-21)

One real business (the owner's mother), no payment, started on `https://turim.d2ryf.com`. This is a pilot of the product, not a public launch: nobody else is invited. Decision: owner, 2026-10-21 ("based on what exists"). The legal texts are presented as official since 2026-10-21 on the owner's instruction (open-decisions G-10); no lawyer reviewed them.

## Before she signs up
- [ ] the owner signed up once himself and the verification e-mail arrived from `@mail.d2ryf.com` with a working link
- [ ] Supabase Auth: Site URL and Redirect URL are `https://turim.d2ryf.com`, SMTP is Resend, leaked-password protection is on
- [ ] the Resend webhook points at `https://turim.d2ryf.com/api/webhooks/resend`

## She signs up
1. She opens `https://turim.d2ryf.com`, presses the start button, enters an e-mail address and a password of 12 characters or more, accepts the terms.
2. She confirms the e-mail, follows the setup (name, kind, phone, services, hours), publishes. Her booking link is shown; she can shorten it in Settings, booking rules ("קישור ההזמנות שלכם").
3. Every new business starts with a 14-day trial of the full plan. A pilot business must not hit the end of the trial: give it a free plan (next section) the same day.

## Free plan for the pilot (no payment, no end date)
Run once in the Supabase SQL editor of the production project after she has created her business. It uses the product's own subscription table and leaves a note in the audit log.
```sql
-- 1. find her business
select b.id, b.slug, b.name, u.email
from public.businesses b
join public.business_members m on m.business_id = b.id
join auth.users u on u.id = m.user_id
order by b.created_at desc;

-- 2. grant the full plan as active with a far end date (replace the id)
update public.subscriptions
set plan_id = 'pro', status = 'active', trial_ends_at = null,
    current_period_end = now() + interval '5 years', cancel_at_period_end = false,
    grace_until = null, provider = 'manual', updated_at = now()
where business_id = '<business id>';

-- 3. record why
insert into public.audit_log (business_id, action, entity, entity_id, meta)
values ('<business id>', 'subscription.pilot_grant', 'business', '<business id>', '{"reason":"closed pilot, no payment"}');
```
Check: she opens Settings, subscription: it must show an active plan, no trial countdown.

## What she can rely on, and what she cannot
- It works: customers book through her link, she sees the agenda, customers get a confirmation and a reminder by e-mail, she can cancel or move.
- Reminders run once a day on the current hosting plan (about 05:10 UTC), not "two hours before".
- Customers' e-mails come from her business name at `@mail.d2ryf.com`; replies go nowhere, so her phone number should be filled in (it is printed in every e-mail).
- Her customers' data is hers; the terms say the platform processes it on her behalf. Deleting the account removes everything after 14 days.
- Support: `d2r.yotam@gmail.com`.

## Watch during the first two weeks
- the e-mail log: bounces or complaints in the Resend dashboard
- `select * from job_status` (job heartbeats) and the Vercel runtime errors
- the first real customer booking and its confirmation e-mail, end to end (check 19 on the production domain)
