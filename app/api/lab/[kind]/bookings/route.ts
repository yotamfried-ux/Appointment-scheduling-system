import { NextResponse } from "next/server";
import { api, fail, parse, readJson, sessionOf } from "@/lib/api/http";
import { CreateBookingRequest } from "@/lib/api/contracts";
import { kindOf } from "@/lib/api/route-helpers";
import { checkRate, createBooking } from "@/lib/api/lab-store";

export const POST = api<{ kind: string }>(async (req, { kind }) => {
  const k = kindOf(kind);
  const session = sessionOf(req);
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key || key.length > 128) throw fail("IDEMPOTENCY_KEY_REQUIRED", "חסר מפתח Idempotency-Key.");
  const limit = Number(req.headers.get("x-lab-limit"));
  checkRate(session, k, Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 20);
  const input = parse(CreateBookingRequest, await readJson(req));
  const { booking, replay } = createBooking(session, k, input, key);
  return NextResponse.json({ booking }, { status: replay ? 200 : 201, headers: replay ? { "Idempotent-Replay": "true" } : {} });
});
