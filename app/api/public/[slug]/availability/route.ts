import { AvailabilityQuery } from "@/lib/api/contracts";
import { api } from "@/lib/api/http";
import { queryOf } from "@/lib/api/route-helpers";
import { clientIp, limitFromHeader } from "@/modules/booking/public/rate-limit";
import { computeAvailability, loadPublicRange } from "@/modules/booking/public/service";

export const GET = api<{ slug: string }>(async (req, { slug }) => {
  const q = queryOf(AvailabilityQuery, req);
  // one database call: rate-limit counter + catalog + busy times
  const { catalog, busy } = await loadPublicRange(slug, q.from, q.days, { value: `${clientIp(req)}|${slug}`, windowSeconds: 60, max: limitFromHeader(req, 240) });
  return computeAvailability(catalog, q.service, q.from, q.days, q.person, busy);
}, { lab: false });
