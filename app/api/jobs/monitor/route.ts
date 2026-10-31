import { NextResponse } from "next/server";
import { api } from "@/lib/api/http";
import { authorizeCron } from "@/lib/security/cron";
import { runProductionMonitor, type MonitorOptions } from "@/modules/notifications/monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = api(async (req) => {
  authorizeCron(req);

  const simulateHeader = req.headers.get("x-monitor-simulate");
  const options: MonitorOptions = {};
  if (simulateHeader === "database" || simulateHeader === "cron") {
    options.simulate = simulateHeader;
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
