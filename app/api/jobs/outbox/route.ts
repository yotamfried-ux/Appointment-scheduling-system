import { api } from "@/lib/api/http";
import { authorizeCron } from "@/lib/security/cron";
import { processOutbox } from "@/modules/notifications/service";
import { systemDb } from "@/platform/system-db";

// Cron / manual trigger. Rows are claimed with SKIP LOCKED, so overlapping runs are safe; the heartbeat row lets monitoring notice a silent cron (OPS-06).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = api(async (req) => {
  authorizeCron(req);
  const key = `m:${new Date().toISOString().slice(0, 16)}`;
  await systemDb().rpc("job_begin", { p_job: "outbox", p_key: key });
  try {
    const summary = await processOutbox();
    await systemDb().rpc("job_finish", { p_job: "outbox", p_key: key, p_error: null });
    return summary;
  } catch (e) {
    await systemDb().rpc("job_finish", { p_job: "outbox", p_key: key, p_error: e instanceof Error ? e.message : "failed" });
    throw e;
  }
}, { lab: false });

export const GET = handler;
export const POST = handler;
