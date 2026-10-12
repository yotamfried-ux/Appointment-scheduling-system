import "server-only";
import { fakeBillingAdapter } from "@/modules/billing/adapters/fake";
import { manualBillingAdapter } from "@/modules/billing/adapters/manual";
import type { BillingPort } from "@/modules/billing/ports";

const isProduction = () => process.env.VERCEL_ENV === "production";

/** Which provider is connected. Fails closed: production never uses the fake provider; with no provider chosen, production runs `manual`. */
export function billingProvider(): BillingPort {
  const which = process.env.BILLING_PROVIDER ?? (isProduction() ? "manual" : "fake");
  if (which === "manual") return manualBillingAdapter();
  if (which === "fake") {
    if (isProduction()) throw new Error("the fake billing provider is not allowed in production");
    return fakeBillingAdapter(fakeBillingSecret());
  }
  // A real provider is added here: `if (which === "<name>") return <name>Adapter({ ...keys from env })`.
  throw new Error("unknown BILLING_PROVIDER");
}

export const fakeBillingSecret = () => process.env.BILLING_WEBHOOK_SECRET ?? (isProduction() ? "" : "dev-only-billing-secret");
