import { NextResponse } from "next/server";
import { z } from "zod";
import { CreateManualRequest, IsoDate } from "@/lib/api/contracts";
import { api, assertSameOrigin, parse, readJson } from "@/lib/api/http";
import { agenda, createManual, ownerContext } from "@/modules/booking/owner/service";
import { systemClock, zonedParts } from "@/platform/clock";

export const GET = api(async (req) => {
  const ctx = await ownerContext();
  const url = new URL(req.url);
  const q = url.searchParams.get("date");
  const date = q === null ? zonedParts(systemClock.now(), ctx.business.timezone).date : parse(IsoDate, q);
  const person = url.searchParams.get("person");
  const fromQ = url.searchParams.get("from");
  const toQ = url.searchParams.get("to");
  const range = fromQ && toQ ? { from: parse(IsoDate, fromQ), to: parse(IsoDate, toQ) } : undefined;
  return agenda(ctx, date, person ? parse(z.uuid(), person) : undefined, range);
}, { lab: false });

export const POST = api(async (req) => {
  assertSameOrigin(req);
  const ctx = await ownerContext();
  const input = parse(CreateManualRequest, await readJson(req));
  return NextResponse.json(await createManual(ctx, input), { status: 201 });
}, { lab: false });
