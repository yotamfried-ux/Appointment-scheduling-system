import { z } from "zod";
import { OwnerTransitionRequest } from "@/lib/api/contracts";
import { api, assertSameOrigin, fail, parse, readJson } from "@/lib/api/http";
import { ownerContext, transition } from "@/modules/booking/owner/service";

export const POST = api<{ id: string }>(async (req, { id }) => {
  assertSameOrigin(req);
  const ctx = await ownerContext();
  if (!z.uuid().safeParse(id).success) throw fail("NOT_FOUND", "לא נמצא.");
  const { action } = parse(OwnerTransitionRequest, await readJson(req));
  return transition(ctx, id, action);
}, { lab: false });
