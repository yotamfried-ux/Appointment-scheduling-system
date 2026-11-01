import { NextResponse } from "next/server";
import { api, fail } from "@/lib/api/http";
import { authorizeMonitoring } from "@/lib/security/cron";
import { runProductionMonitor, type MonitorOptions } from "@/modules/notifications/monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = api(async (req) => {
  const { isCronSecret } = authorizeMonitoring(req);

  const simulateHeader = req.headers.get("x-monitor-simulate");
  const forceRetryHeader = req.headers.get("x-monitor-force-retry") ?? req.headers.get("x-monitor-ignore-backoff");

  const options: MonitorOptions = {};
  if (simulateHeader === "database" || simulateHeader === "cron") {
    options.simulate = simulateHeader;
  } else if (simulateHeader === "none" || simulateHeader === "clear") {
    options.simulate = "none";
  }

  if (forceRetryHeader === "true" || forceRetryHeader === "1") {
    options.ignoreBackoff = true;
  }

  // Least-privilege guardrail:
  // Simulations and manual backoff overrides require execution-level CRON_SECRET, not read-only MONITOR_SECRET.
  if ((options.simulate || options.ignoreBackoff) && !isCronSecret) {
    throw fail("FORBIDDEN", "פעולות סימולציה או אילוץ הרצה דורשות הרשאת CRON_SECRET.");
  }

  const report = await runProductionMonitor(options);
  const status = report.healthy ? 200 : 503;

  return NextResponse.json(report, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}, { lab: false });

export const GET = handler;
export const POST = handler;
