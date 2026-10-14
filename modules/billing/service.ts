import "server-only";
import { fail } from "@/lib/api/http";
import type { OwnerCtx } from "@/modules/booking/owner/service";
import { billingProvider } from "@/modules/billing/config";
import { myBilling, type MyBilling } from "@/modules/billing/entitlements";
import type { CheckoutResult } from "@/modules/billing/ports";
import { subscriptionLinks } from "@/modules/billing/system";

export interface PlanView {
  id: string;
  name: string;
  priceCents: number;
  interval: string;
  features: { waitlist: boolean; export: boolean; maxServices: number | null };
}

export interface BillingView extends MyBilling {
  plans: PlanView[];
  /** Only owners and admins may change the subscription. */
  canManage: boolean;
  providerName: string;
}

export async function billingView(ctx: OwnerCtx): Promise<BillingView> {
  const [mine, plans, feats] = await Promise.all([
    myBilling(ctx),
    ctx.supabase.from("plans").select("id, name, price_cents, interval").eq("active", true).order("position"),
    ctx.supabase.from("plan_features").select("plan_id, key, bool_value, int_value"),
  ]);
  if (plans.error || feats.error) throw new Error("billing unavailable");
  const f = (id: string) => (feats.data ?? []).filter((x) => x.plan_id === id);
  return {
    ...mine,
    canManage: ctx.role === "owner" || ctx.role === "admin",
    providerName: billingProvider().name,
    plans: (plans.data ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      priceCents: p.price_cents as number,
      interval: p.interval as string,
      features: {
        waitlist: f(p.id as string).find((x) => x.key === "waitlist")?.bool_value === true,
        export: f(p.id as string).find((x) => x.key === "export")?.bool_value === true,
        maxServices: (f(p.id as string).find((x) => x.key === "max_services")?.int_value as number | null | undefined) ?? null,
      },
    })),
  };
}

function requireManager(ctx: OwnerCtx) {
  if (ctx.role !== "owner" && ctx.role !== "admin") throw fail("FORBIDDEN", "רק מנהל העסק יכול לנהל את המנוי.");
}

export async function startCheckout(ctx: OwnerCtx, planId: string, origin: string): Promise<CheckoutResult> {
  requireManager(ctx);
  const { data } = await ctx.supabase.from("plans").select("id").eq("id", planId).eq("active", true).maybeSingle();
  if (!data) throw fail("VALIDATION_FAILED", "הבקשה אינה תקינה.", [{ field: "planId", message: "החבילה אינה קיימת." }]);
  const links = await subscriptionLinks(ctx.business.id);
  return billingProvider().createCheckout({ businessId: ctx.business.id, planId, returnUrl: `${origin}/settings/billing?checkout=return`, externalCustomerId: links.externalCustomerId });
}

export async function openPortal(ctx: OwnerCtx, origin: string): Promise<{ url: string } | null> {
  requireManager(ctx);
  const links = await subscriptionLinks(ctx.business.id);
  return billingProvider().createPortal({ businessId: ctx.business.id, returnUrl: `${origin}/settings/billing`, externalCustomerId: links.externalCustomerId });
}
