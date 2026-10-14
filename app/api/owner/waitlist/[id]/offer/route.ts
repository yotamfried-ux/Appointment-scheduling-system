import { after, NextResponse } from "next/server";
import { z } from "zod";
import { OwnerOfferRequest } from "@/lib/api/contracts";
import { api, assertSameOrigin, fail, parse, readJson } from "@/lib/api/http";
import { ownerContext, waitlistOffer } from "@/modules/booking/owner/service";
import { kickOutbox } from "@/modules/notifications/service";

export const POST = api<{ id: string }>(async (req, { id }) => {
  assertSameOrigin(req);
  const ctx = await ownerContext();
  if (!z.uuid().safeParse(id).success) throw fail("NOT_FOUND", "לא נמצא.");
  const { time } = parse(OwnerOfferRequest, await readJson(req));
  await waitlistOffer(ctx, id, time);
  after(kickOutbox);
  return NextResponse.json({ ok: true }, { status: 201 });
}, { lab: false });
