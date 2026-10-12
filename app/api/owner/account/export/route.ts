import { api, fail } from "@/lib/api/http";
import { clientIp, enforce, limitFromHeader } from "@/modules/booking/public/rate-limit";
import { ownerContext } from "@/modules/booking/owner/service";
import { exportAccount, requireOwner } from "@/modules/account/service";

// ACC-09: the whole account as JSON. Owner only, cross-site navigations refused, rate limited, audited in the database before the data leaves.
export const GET = api(async (req) => {
  const ctx = await ownerContext();
  requireOwner(ctx);
  if (req.headers.get("sec-fetch-site") === "cross-site") throw fail("FORBIDDEN", "הבקשה נדחתה.");
  await enforce([
    { scope: "account-export", value: ctx.business.id, windowSeconds: 3600, max: limitFromHeader(req, 10) },
    { scope: "account-export-ip", value: clientIp(req), windowSeconds: 3600, max: limitFromHeader(req, 30) },
  ]);
  const out = await exportAccount(ctx);
  return new Response(out.body, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${out.filename}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
}, { lab: false });
