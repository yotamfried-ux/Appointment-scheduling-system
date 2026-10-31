import { timingSafeEqual } from "node:crypto";
import { fail } from "@/lib/api/http";

function matchBearerSecret(header: string, secret: string): boolean {
  if (!secret || secret.length < 16) return false;
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const want = Buffer.from(secret);
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}

/** Cron/job endpoints: `Authorization: Bearer $CRON_SECRET` (what Vercel Cron sends). Fails closed when the secret is not configured. */
export function authorizeCron(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) throw fail("UNAVAILABLE", "השירות אינו מוגדר.");
  const header = req.headers.get("authorization") ?? "";
  if (!matchBearerSecret(header, secret)) throw fail("UNAUTHENTICATED", "אין הרשאה.");
}

/**
 * Monitoring endpoints (e.g. /api/jobs/health):
 * Allows least-privilege monitoring with `MONITOR_SECRET` so external monitors
 * do not need execution-capable `CRON_SECRET`. Falls back to `CRON_SECRET` if `MONITOR_SECRET` is not set.
 * Fails closed if neither is configured (or secret is too short).
 */
export function authorizeMonitoring(req: Request) {
  const monitorSecret = process.env.MONITOR_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const hasMonitor = !!(monitorSecret && monitorSecret.length >= 16);
  const hasCron = !!(cronSecret && cronSecret.length >= 16);

  if (!hasMonitor && !hasCron) {
    throw fail("UNAVAILABLE", "השירות אינו מוגדר.");
  }

  const header = req.headers.get("authorization") ?? "";
  const okMonitor = hasMonitor && matchBearerSecret(header, monitorSecret!);
  const okCron = hasCron && matchBearerSecret(header, cronSecret!);

  if (!okMonitor && !okCron) {
    throw fail("UNAUTHENTICATED", "אין הרשאה.");
  }
}
