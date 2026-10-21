import { api } from "@/lib/api/http";
import { authorizeCron } from "@/lib/security/cron";
import { processOutbox } from "@/modules/notifications/service";
import { systemDb } from "@/platform/system-db";

// Every 5 minutes: expire unanswered offers (and pass the slot on), release lost ones, tidy past days (WLT-03/05). Idempotent by construction;
// the heartbeat row lets monitoring notice a silent cron (OPS-06). Then the outbox sends whatever the sweep queued.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = api(async (req) => {
  authorizeCron(req);
  const key = `m:${new Date().toISOString().slice(0, 16)}`;
  await systemDb().rpc("job_begin", { p_job: "waitlist", p_key: key });
  try {
    const { data, error } = await systemDb().rpc("waitlist_sweep", { p_now: new Date().toISOString() });
    if (error) throw new Error("sweep failed");
    const sent = await processOutbox();
    await systemDb().rpc("job_finish", { p_job: "waitlist", p_key: key, p_error: null });
    return { sweep: data, outbox: sent };
  } catch (e) {
    await systemDb().rpc("job_finish", { p_job: "waitlist", p_key: key, p_error: e instanceof Error ? e.message : "failed" });
    throw e;
  }
}, { lab: false });

export const GET = handler;
export const POST = handler;
