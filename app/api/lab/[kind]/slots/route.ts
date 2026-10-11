import { api, sessionOf } from "@/lib/api/http";
import { SlotsQuery } from "@/lib/api/contracts";
import { kindOf, queryOf } from "@/lib/api/route-helpers";
import { slotsFor } from "@/lib/api/lab-store";

export const GET = api<{ kind: string }>(async (req, { kind }) => {
  const q = queryOf(SlotsQuery, req);
  return slotsFor(sessionOf(req), kindOf(kind), q.service, q.date, q.selected);
});
