import { api, assertSameOrigin } from "@/lib/api/http";
import { openPortal } from "@/modules/billing/service";
import { ownerContext } from "@/modules/booking/owner/service";

export const POST = api(async (req) => {
  assertSameOrigin(req);
  const ctx = await ownerContext();
  return { portal: await openPortal(ctx, new URL(req.url).origin) };
}, { lab: false });
