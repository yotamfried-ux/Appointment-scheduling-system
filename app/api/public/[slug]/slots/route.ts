import { SlotsQuery } from "@/lib/api/contracts";
import { api } from "@/lib/api/http";
import { queryOf } from "@/lib/api/route-helpers";
import { clientIp, limitFromHeader } from "@/modules/booking/public/rate-limit";
import { computeSlots, loadPublicRange } from "@/modules/booking/public/service";

export const GET = api<{ slug: string }>(async (req, { slug }) => {
  const q = queryOf(SlotsQuery, req);
  // one database call: rate-limit counter + catalog + busy times
  const { catalog, busy } = await loadPublicRange(slug, q.date, 1, { value: `${clientIp(req)}|${slug}`, windowSeconds: 60, max: limitFromHeader(req, 240) });
  return computeSlots(catalog, q.service, q.date, q.selected, q.person, busy);
}, { lab: false });
