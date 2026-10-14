import { NextResponse } from "next/server";

// Liveness only: never touches the DB (docs/03 OPS-03). Readiness comes with the DB module.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
