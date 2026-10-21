import { api, fail } from "@/lib/api/http";
import { clientIp, enforce, limitFromHeader } from "@/modules/booking/public/rate-limit";
import { catalogOr404 } from "@/modules/booking/public/resolve";
import { toServicesResponse } from "@/modules/booking/public/service";

export const GET = api<{ slug: string }>(async (req, { slug }) => {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) throw fail("NOT_FOUND", "לא נמצא."); // before any limiter row is written for a junk slug
  await enforce([{ scope: "read", value: `${clientIp(req)}|${slug}`, windowSeconds: 60, max: limitFromHeader(req, 240) }]);
  return toServicesResponse(await catalogOr404(slug));
}, { lab: false });
