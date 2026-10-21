import { expect, test } from "@playwright/test";
import { auth, byType, drain, rows } from "./helpers/outbox";
import { makeBusiness, sql } from "./helpers/business";

// B8: the owner is mailed when the trial is ending and when a payment failed. Real stack: the reminders job (which runs the owner housekeeping), the outbox, the fake provider.
const run = (request: import("@playwright/test").APIRequestContext) => request.post("/api/jobs/reminders", { headers: auth });
const bucket = () => sql(`delete from public.job_runs where job_name = 'reminders'`);

test("a trial with 5 days left, a last day, and a failed payment each produce one honest mail to the owner; a paying owner gets none", async ({ request }) => {
  const b = await makeBusiness("barber");
  bucket(); await run(request);
  expect(byType(await rows(b), "owner_trial_ending"), "14 days left: nothing yet").toHaveLength(0);

  sql(`update public.subscriptions set trial_ends_at = now() + interval '5 days' where business_id='${b.id}'`);
  bucket(); await run(request); bucket(); await run(request); // twice: once per milestone
  await drain(request, async () => byType(await rows(b), "owner_trial_ending").some((r) => r.status === "sent"));
  const ending = byType(await rows(b), "owner_trial_ending");
  expect(ending).toHaveLength(1);
  expect(ending[0].preview!.text).toMatch(/ימים שנותרו: [45]/);
  expect(ending[0].preview!.text).toContain("/settings/billing");

  sql(`update public.subscriptions set trial_ends_at = now() + interval '8 hours' where business_id='${b.id}'`);
  bucket(); await run(request);
  await drain(request, async () => byType(await rows(b), "owner_trial_last_day").some((r) => r.status === "sent"));
  expect(byType(await rows(b), "owner_trial_last_day")).toHaveLength(1);

  // a card failure: grace period, one mail
  sql(`update public.subscriptions set status='past_due', grace_until = now() + interval '5 days', trial_ends_at = null where business_id='${b.id}'`);
  bucket(); await run(request);
  await drain(request, async () => byType(await rows(b), "owner_payment_failed").some((r) => r.status === "sent"));
  expect(byType(await rows(b), "owner_payment_failed")[0].preview!.text).toContain("תקופת החסד עד");

  // she pays before a queued notice is sent: it is skipped, not sent (check-before-send)
  const paid = await makeBusiness("barber");
  sql(`insert into public.notification_log (business_id, type, recipient, digest_date, next_attempt_at) values ('${paid.id}', 'owner_payment_failed', 'owner', current_date, now() + interval '1 hour')`); // queued, not yet sent
  sql(`update public.subscriptions set status='active', grace_until = null where business_id='${paid.id}'`);
  sql(`update public.notification_log set next_attempt_at = now() - interval '1 second' where business_id='${paid.id}'`);
  await drain(request, async () => (await rows(paid)).every((r) => !["queued", "sending"].includes(r.status)) && (await rows(paid)).length > 0);
  const r = byType(await rows(paid), "owner_payment_failed");
  expect(r).toHaveLength(1);
  expect(r[0]).toMatchObject({ status: "skipped", skip_reason: "subscription_changed" });
});
