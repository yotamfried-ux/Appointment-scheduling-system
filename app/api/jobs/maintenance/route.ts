import { api } from "@/lib/api/http";
import { authorizeCron } from "@/lib/security/cron";
import { systemDb } from "@/platform/system-db";

// Daily housekeeping with explicit retention (see the migration for exactly what and how long). Never touches business data. Idempotent.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = api(async (req) => {
  authorizeCron(req);
  const key = `d:${new Date().toISOString().slice(0, 13)}`;
  await systemDb().rpc("job_begin", { p_job: "maintenance", p_key: key });
  try {
    const { data, error } = await systemDb().rpc("maintenance_run", { p_now: new Date().toISOString() });
    if (error) throw new Error("maintenance failed");
    await systemDb().rpc("job_finish", { p_job: "maintenance", p_key: key, p_error: null });
    return { removed: data };
  } catch (e) {
    await systemDb().rpc("job_finish", { p_job: "maintenance", p_key: key, p_error: e instanceof Error ? e.message : "failed" });
    throw e;
  }
}, { lab: false });

export const GET = handler;
export const POST = handler;
