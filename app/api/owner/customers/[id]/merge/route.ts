import { z } from "zod";
import { api, parse } from "@/lib/api/http";
import { MergeCustomersRequest } from "@/lib/api/contracts";
import { ownerContext } from "@/modules/booking/owner/service";
import { mergeCustomers } from "@/modules/customers/service";

export const POST = api<{ id: string }>(async (req, { id }) => {
  const ctx = await ownerContext();
  const sourceId = parse(z.string().uuid(), id);
  const body = parse(MergeCustomersRequest, await req.json());
  return mergeCustomers(ctx, sourceId, body.targetId);
}, { lab: false });
