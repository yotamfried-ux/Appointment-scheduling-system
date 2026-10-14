import { expect, type APIRequestContext } from "@playwright/test";
import { admin, rand, sql, type TestBusiness } from "./business";
import { CRON_SECRET } from "./secrets";

// Shared helpers for specs that drive the notification outbox and the cron endpoints on the real stack.
export const auth = { authorization: `Bearer ${CRON_SECRET}` };
export const mail = (tag = "") => `n-${rand()}${tag}@example.com`;

export interface Row {
  appointment_id: string | null;
  offer_id: string | null;
  type: string;
  recipient: string;
  status: string;
  attempts: number;
  skip_reason: string | null;
  error: string | null;
  provider_message_id: string | null;
  preview: { to: string; subject: string; text: string } | null;
}
export const rows = async (b: TestBusiness) =>
  (await admin().from("notification_log").select("appointment_id, offer_id, type, recipient, status, attempts, skip_reason, error, provider_message_id, preview").eq("business_id", b.id).order("created_at")).data as Row[];
export const byType = (rs: Row[], type: string) => rs.filter((r) => r.type === type);
export const runOutbox = (request: APIRequestContext) => request.post("/api/jobs/outbox", { headers: auth });
export const runWaitlistSweep = (request: APIRequestContext) => request.post("/api/jobs/waitlist", { headers: auth });

/** Run the outbox until `done` holds (other specs leave events behind, and a run handles a bounded batch). */
export async function drain(request: APIRequestContext, done: () => Promise<boolean>, releaseFor?: string) {
  for (let i = 0; i < 60; i++) {
    if (releaseFor) release(releaseFor); // the backoff of any retrying message of this appointment has "elapsed"
    expect((await runOutbox(request)).status()).toBe(200);
    if (await done()) return;
  }
  throw new Error("outbox did not settle");
}
/** Nobody (including a parallel spec's runner) is mid-send. */
export const idle = (rs: Row[]) => rs.every((r) => !["queued", "sending"].includes(r.status));
export const settled = (b: TestBusiness, n: number) => async () => {
  const rs = await rows(b);
  return rs.length >= n && idle(rs);
};
export const release = (appointmentId: string, type?: string) =>
  sql(`update public.notification_log set next_attempt_at = now() - interval '1 second' where appointment_id = '${appointmentId}'${type ? ` and type = '${type}'` : ""} and status in ('queued','failed')`);
/** Each test starts from a clean reminder bucket: desktop and mobile runs book the same slot, and a used bucket is (rightly) skipped. */
export const freshBucket = (t: Date) => sql(`delete from public.job_runs where job_name = 'reminders' and run_key = 'r:${new Date(Math.floor(t.getTime() / 900_000) * 900_000).toISOString().slice(0, 16)}'`);
