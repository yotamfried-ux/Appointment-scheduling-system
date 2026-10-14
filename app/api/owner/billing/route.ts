import { api } from "@/lib/api/http";
import { billingView } from "@/modules/billing/service";
import { ownerContext } from "@/modules/booking/owner/service";

export const GET = api(async () => billingView(await ownerContext()), { lab: false });
