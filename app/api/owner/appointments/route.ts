import { NextResponse } from "next/server";
import { CreateManualRequest, IsoDate } from "@/lib/api/contracts";
import { api, assertSameOrigin, parse, readJson } from "@/lib/api/http";
import { agenda, createManual, ownerContext } from "@/modules/booking/owner/service";
import { systemClock, zonedParts } from "@/platform/clock";

export const GET = api(async (req) => {
  const ctx = await ownerContext();
  const q = new URL(req.url).searchParams.get("date");
  const date = q === null ? zonedParts(systemClock.now(), ctx.business.timezone).date : parse(IsoDate, q);
  return agenda(ctx, date);
}, { lab: false });

export const POST = api(async (req) => {
  assertSameOrigin(req);
  const ctx = await ownerContext();
  const input = parse(CreateManualRequest, await readJson(req));
  return NextResponse.json(await createManual(ctx, input), { status: 201 });
}, { lab: false });
