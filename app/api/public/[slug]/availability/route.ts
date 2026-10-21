import { AvailabilityQuery } from "@/lib/api/contracts";
import { api } from "@/lib/api/http";
import { queryOf } from "@/lib/api/route-helpers";
import { clientIp, enforce, limitFromHeader } from "@/modules/booking/public/rate-limit";
import { catalogOr404 } from "@/modules/booking/public/resolve";
import { computeAvailability } from "@/modules/booking/public/service";

export const GET = api<{ slug: string }>(async (req, { slug }) => {
  const q0 = [{ scope: "read", value: `${clientIp(req)}|${slug}`, windowSeconds: 60, max: limitFromHeader(req, 240) }];
  const [, catalog] = await Promise.all([enforce(q0), catalogOr404(slug)]); // the rate-limit write and the catalog read do not depend on each other
  const q = queryOf(AvailabilityQuery, req);
  return computeAvailability(catalog, q.service, q.from, q.days, q.person);
}, { lab: false });
