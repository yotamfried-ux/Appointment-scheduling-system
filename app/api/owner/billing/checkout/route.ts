import { api, assertSameOrigin, parse, readJson } from "@/lib/api/http";
import { CheckoutRequestBody } from "@/modules/billing/schema";
import { startCheckout } from "@/modules/billing/service";
import { ownerContext } from "@/modules/booking/owner/service";

// Starting a checkout changes nothing: the subscription changes only when the provider's webhook arrives (BIL-04).
export const POST = api(async (req) => {
  assertSameOrigin(req);
  const ctx = await ownerContext();
  const { planId } = parse(CheckoutRequestBody, await readJson(req));
  return startCheckout(ctx, planId, new URL(req.url).origin);
}, { lab: false });
