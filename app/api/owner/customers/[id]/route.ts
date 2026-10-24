import { z } from "zod";
import { api, parse } from "@/lib/api/http";
import { UpdateCustomerRequest } from "@/lib/api/contracts";
import { ownerContext } from "@/modules/booking/owner/service";
import { customerDetail, updateCustomer } from "@/modules/customers/service";

export const GET = api<{ id: string }>(async (_req, { id }) => {
  const ctx = await ownerContext();
  return customerDetail(ctx, parse(z.string().uuid(), id));
}, { lab: false });

export const PATCH = api<{ id: string }>(async (req, { id }) => {
  const ctx = await ownerContext();
  const customerId = parse(z.string().uuid(), id);
  const body = parse(UpdateCustomerRequest, await req.json());
  await updateCustomer(ctx, customerId, body);
  return { ok: true };
}, { lab: false });
