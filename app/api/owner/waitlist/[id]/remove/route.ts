import { after, NextResponse } from "next/server";
import { z } from "zod";
import { api, assertSameOrigin, fail } from "@/lib/api/http";
import { ownerContext, waitlistRemove } from "@/modules/booking/owner/service";
import { kickOutbox } from "@/modules/notifications/service";

export const POST = api<{ id: string }>(async (req, { id }) => {
  assertSameOrigin(req);
  const ctx = await ownerContext();
  if (!z.uuid().safeParse(id).success) throw fail("NOT_FOUND", "לא נמצא.");
  await waitlistRemove(ctx, id);
  after(kickOutbox); // a withdrawn offer passes the slot on: the next person is told now
  return NextResponse.json({ ok: true });
}, { lab: false });
