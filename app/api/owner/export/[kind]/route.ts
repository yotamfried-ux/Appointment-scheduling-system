import { z } from "zod";
import { IsoDate } from "@/lib/api/contracts";
import { api, fail, parse } from "@/lib/api/http";
import { clientIp, enforce, limitFromHeader } from "@/modules/booking/public/rate-limit";
import { ownerContext } from "@/modules/booking/owner/service";
import { exportAppointments, exportCustomers, requireAdmin } from "@/modules/reports/service";

const Range = z.object({ from: IsoDate, to: IsoDate });

// A download is a GET, so it carries no state change and needs no Origin check; it is admin-only, validated first (a malformed request costs nothing),
// then rate limited per business and per client, and audited before any data leaves.
export const GET = api<{ kind: string }>(async (req, { kind }) => {
  const ctx = await ownerContext();
  requireAdmin(ctx);
  if (kind !== "customers" && kind !== "appointments") throw fail("NOT_FOUND", "לא נמצא.");
  const sp = new URL(req.url).searchParams;
  const range = kind === "appointments" ? parse(Range, { from: sp.get("from"), to: sp.get("to") }) : null;
  if (range && range.from > range.to) throw fail("VALIDATION_FAILED", "תאריך ההתחלה אחרי תאריך הסיום.", [{ field: "from", message: "תאריך ההתחלה אחרי תאריך הסיום." }]);
  await enforce([
    { scope: "owner-export", value: ctx.business.id, windowSeconds: 3600, max: limitFromHeader(req, 20) },
    { scope: "owner-export-ip", value: clientIp(req), windowSeconds: 3600, max: limitFromHeader(req, 60) },
  ]);
  const out = range ? await exportAppointments(ctx, range.from, range.to) : await exportCustomers(ctx);
  return new Response(out.body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${out.filename}"`, "X-Content-Type-Options": "nosniff" },
  });
}, { lab: false });
