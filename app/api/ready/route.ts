import { NextResponse } from "next/server";
import { databaseReady } from "@/platform/db-ready";

// Readiness (OPS-03): can this instance reach its database right now? Liveness (/api/health) never touches the DB; this does, with a short timeout.
// The body says only ready/unavailable: no host names, no error text, nothing an outsider could learn from it.
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  return (await databaseReady())
    ? NextResponse.json({ status: "ready" }, { headers })
    : NextResponse.json({ status: "unavailable" }, { status: 503, headers });
}
