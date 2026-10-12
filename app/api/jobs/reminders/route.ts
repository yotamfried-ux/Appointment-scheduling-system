import { api, fail } from "@/lib/api/http";
import { authorizeCron } from "@/lib/security/cron";
import { runReminders } from "@/modules/notifications/service";
import { systemDb } from "@/platform/system-db";
import { isProductionLike } from "@/lib/env";

// Every 15 minutes. The run key is the 15-minute bucket: a duplicate trigger of the same bucket does nothing (OPS-05).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = api(async (req) => {
  authorizeCron(req);
  let now = new Date();
  const test = new URL(req.url).searchParams.get("now");
  if (test !== null) {
    if (process.env.ALLOW_TEST_CLOCK !== "1" || isProductionLike()) throw fail("NOT_FOUND", "לא נמצא."); // a test clock exists in dev/CI only
    now = new Date(test);
    if (Number.isNaN(now.getTime())) throw fail("BAD_REQUEST", "זמן לא תקין.");
  }
  const bucket = new Date(Math.floor(now.getTime() / 900_000) * 900_000).toISOString().slice(0, 16);
  const key = `r:${bucket}`;
  const { data: owns, error } = await systemDb().rpc("job_begin", { p_job: "reminders", p_key: key });
  if (error) throw new Error("job_begin failed");
  if (!owns) return { skipped: true, bucket };
  try {
    const summary = await runReminders(now);
    await systemDb().rpc("job_finish", { p_job: "reminders", p_key: key, p_error: null });
    return { ...summary, skipped: false, bucket };
  } catch (e) {
    await systemDb().rpc("job_finish", { p_job: "reminders", p_key: key, p_error: e instanceof Error ? e.message : "failed" });
    throw e;
  }
}, { lab: false });

export const GET = handler;
export const POST = handler;
