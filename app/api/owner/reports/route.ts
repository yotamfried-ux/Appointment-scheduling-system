import { z } from "zod";
import { IsoDate } from "@/lib/api/contracts";
import { api, fail, parse } from "@/lib/api/http";
import { ownerContext } from "@/modules/booking/owner/service";
import { report } from "@/modules/reports/service";
import { resolvePeriod } from "@/modules/reports/metrics";
import { systemClock, zonedParts } from "@/platform/clock";

const Query = z.object({ from: IsoDate, to: IsoDate });

export const GET = api(async (req) => {
  const ctx = await ownerContext();
  const sp = new URL(req.url).searchParams;
  const def = resolvePeriod(zonedParts(systemClock.now(), ctx.business.timezone).date, "30d");
  const { from, to } = parse(Query, { from: sp.get("from") ?? def.from, to: sp.get("to") ?? def.to });
  if (from > to) throw fail("VALIDATION_FAILED", "תאריך ההתחלה אחרי תאריך הסיום.", [{ field: "from", message: "תאריך ההתחלה אחרי תאריך הסיום." }]);
  return report(ctx, from, to);
}, { lab: false });
