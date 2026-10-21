import { NextResponse } from "next/server";
import { api } from "@/lib/api/http";
import { authorizeCron } from "@/lib/security/cron";
import { jobHealth } from "@/modules/notifications/job-health";

// For an external uptime monitor (OPS-06): 200 when every scheduled job has succeeded recently, 503 otherwise, so a silent cron raises an alert.
// Needs the cron secret: job names and timings are not for the public.
export const dynamic = "force-dynamic";

export const GET = api(async (req) => {
  authorizeCron(req);
  const h = await jobHealth();
  return NextResponse.json(h, { status: h.ok ? 200 : 503 });
}, { lab: false });
