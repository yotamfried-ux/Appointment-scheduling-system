import { z } from "zod";
import { api, parse } from "@/lib/api/http";
import { ownerContext } from "@/modules/booking/owner/service";
import { listCustomers, SORTS } from "@/modules/customers/service";

const Query = z.object({
  q: z.string().max(80).optional(),
  sort: z.enum(SORTS).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

export const GET = api(async (req) => {
  const ctx = await ownerContext();
  const sp = new URL(req.url).searchParams;
  const q = parse(Query, { q: sp.get("q") ?? undefined, sort: sp.get("sort") ?? undefined, page: sp.get("page") ?? undefined });
  return listCustomers(ctx, q);
}, { lab: false });
