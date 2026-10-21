import { api, sessionOf } from "@/lib/api/http";
import { AvailabilityQuery } from "@/lib/api/contracts";
import { kindOf, queryOf } from "@/lib/api/route-helpers";
import { availabilityFor } from "@/lib/api/lab-store";

export const GET = api<{ kind: string }>(async (req, { kind }) => {
  const q = queryOf(AvailabilityQuery, req);
  return availabilityFor(sessionOf(req), kindOf(kind), q.service, q.from, q.days);
});
