import { api, fail } from "@/lib/api/http";
import { clientIp, enforce, limitFromHeader } from "@/modules/booking/public/rate-limit";
import { ownerContext } from "@/modules/booking/owner/service";
import { exportAccount, exportAccountXlsx, requireOwner } from "@/modules/account/service";
import { XLSX_MIME } from "@/modules/reports/xlsx";

// ACC-09: the whole account export. Owner only, cross-site navigations refused, rate limited, audited in the database before the data leaves.
export const GET = api(async (req) => {
  const ctx = await ownerContext();
  requireOwner(ctx);
  if (req.headers.get("sec-fetch-site") === "cross-site") throw fail("FORBIDDEN", "הבקשה נדחתה.");
  await enforce([
    { scope: "account-export", value: ctx.business.id, windowSeconds: 3600, max: limitFromHeader(req, 10) },
    { scope: "account-export-ip", value: clientIp(req), windowSeconds: 3600, max: limitFromHeader(req, 30) },
  ]);
  const sp = new URL(req.url).searchParams;
  const wantsXlsx = sp.get("format") === "xlsx" || req.headers.get("sec-fetch-dest") === "document";
  if (wantsXlsx) {
    const out = await exportAccountXlsx(ctx);
    return new Response(Buffer.from(out.body), {
      headers: {
        "Content-Type": XLSX_MIME,
        "Content-Disposition": `attachment; filename="${out.filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  }
  const out = await exportAccount(ctx);
  return new Response(out.body, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${out.filename}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
}, { lab: false });
