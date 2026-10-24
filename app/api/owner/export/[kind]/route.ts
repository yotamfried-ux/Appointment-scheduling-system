import { z } from "zod";
import { IsoDate } from "@/lib/api/contracts";
import { api, fail, parse } from "@/lib/api/http";
import { clientIp, enforce, limitFromHeader } from "@/modules/booking/public/rate-limit";
import { ownerContext } from "@/modules/booking/owner/service";
import { exportAppointments, exportAppointmentsXlsx, exportCustomers, exportCustomersXlsx, requireAdmin } from "@/modules/reports/service";
import { XLSX_MIME } from "@/modules/reports/xlsx";

const Range = z.object({ from: IsoDate, to: IsoDate });

// A download is a GET, so it carries no state change and needs no Origin check; it is admin-only, validated first (a malformed request costs nothing),
// then rate limited per business and per client, and audited before any data leaves.
export const GET = api<{ kind: string }>(async (req, { kind }) => {
  const ctx = await ownerContext();
  requireAdmin(ctx);
  if (kind !== "customers" && kind !== "appointments") throw fail("NOT_FOUND", "לא נמצא.");
  // Cookie-authenticated GET that returns a whole data set: a cross-site navigation must not be able to trigger it.
  if (req.headers.get("sec-fetch-site") === "cross-site") throw fail("FORBIDDEN", "הבקשה נדחתה.");
  const sp = new URL(req.url).searchParams;
  const range = kind === "appointments" ? parse(Range, { from: sp.get("from"), to: sp.get("to") }) : null;
  if (range && range.from > range.to) throw fail("VALIDATION_FAILED", "תאריך ההתחלה אחרי תאריך הסיום.", [{ field: "from", message: "תאריך ההתחלה אחרי תאריך הסיום." }]);
  if (range && Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`) > 1096 * 86_400_000) throw fail("VALIDATION_FAILED", "אפשר לייצא עד שלוש שנים בכל פעם.", [{ field: "from", message: "טווח התאריכים ארוך מדי (עד שלוש שנים)." }]);
  await enforce([
    { scope: "owner-export", value: ctx.business.id, windowSeconds: 3600, max: limitFromHeader(req, 20) },
    { scope: "owner-export-ip", value: clientIp(req), windowSeconds: 3600, max: limitFromHeader(req, 60) },
  ]);
  const wantsXlsx = sp.get("format") === "xlsx" || req.headers.get("sec-fetch-dest") === "document";
  if (wantsXlsx) {
    const out = range ? await exportAppointmentsXlsx(ctx, range.from, range.to) : await exportCustomersXlsx(ctx);
    return new Response(Buffer.from(out.body), {
      headers: {
        "Content-Type": XLSX_MIME,
        "Content-Disposition": `attachment; filename="${out.filename}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const out = range ? await exportAppointments(ctx, range.from, range.to) : await exportCustomers(ctx);
  return new Response(out.body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${out.filename}"`, "X-Content-Type-Options": "nosniff" },
  });
}, { lab: false });
