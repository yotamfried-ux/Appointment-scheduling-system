import { after } from "next/server";
import { z } from "zod";
import { OwnerMoveRequest } from "@/lib/api/contracts";
import { api, assertSameOrigin, fail, parse, readJson } from "@/lib/api/http";
import { moveAppointment, ownerContext } from "@/modules/booking/owner/service";
import { kickOutbox } from "@/modules/notifications/service";

// RSC-04: the owner moves a booking; the customer is told by mail and may always decline. Admin or owner (the database decides).
export const POST = api<{ id: string }>(async (req, { id }) => {
  assertSameOrigin(req);
  const ctx = await ownerContext();
  if (!z.uuid().safeParse(id).success) throw fail("NOT_FOUND", "לא נמצא.");
  const result = await moveAppointment(ctx, id, parse(OwnerMoveRequest, await readJson(req)));
  after(kickOutbox);
  return result;
}, { lab: false });
