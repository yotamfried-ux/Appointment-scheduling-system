import { z } from "zod";
import { api, parse } from "@/lib/api/http";
import { ownerContext } from "@/modules/booking/owner/service";
import { customerDetail } from "@/modules/customers/service";

export const GET = api<{ id: string }>(async (_req, { id }) => {
  const ctx = await ownerContext();
  return customerDetail(ctx, parse(z.string().uuid(), id));
}, { lab: false });
