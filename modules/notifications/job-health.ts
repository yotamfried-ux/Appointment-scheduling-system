import "server-only";
import { systemDb } from "@/platform/system-db";

/** How long a job may go without a success before somebody should be told (OPS-06). Roughly two missed runs each. */
export const EXPECTED_MAX_AGE_MINUTES: Record<string, number> = { outbox: 15, reminders: 45, waitlist: 15, maintenance: 36 * 60 };

export interface JobHealth {
  job: string;
  lastOk: string | null;
  ageMinutes: number | null;
  failed24h: number;
  stale: boolean;
}

export function assess(rows: { job: string; lastOk: string | null; failed24h: number }[], now = Date.now()): { ok: boolean; jobs: JobHealth[] } {
  const seen = new Map(rows.map((r) => [r.job, r]));
  // a job that has NEVER run is as bad as one that stopped: every expected job is listed
  const jobs = Object.keys(EXPECTED_MAX_AGE_MINUTES).map((job): JobHealth => {
    const r = seen.get(job);
    const age = r?.lastOk ? Math.floor((now - Date.parse(r.lastOk)) / 60_000) : null;
    return { job, lastOk: r?.lastOk ?? null, ageMinutes: age, failed24h: r?.failed24h ?? 0, stale: age === null || age > EXPECTED_MAX_AGE_MINUTES[job] };
  });
  return { ok: jobs.every((j) => !j.stale), jobs };
}

export async function jobHealth() {
  const { data, error } = await systemDb().rpc("job_status");
  if (error) throw new Error("job status unavailable");
  return assess((data as { job: string; lastOk: string | null; failed24h: number }[]) ?? []);
}
