import { getTranslations } from "next-intl/server";
import { BillingPanel } from "@/app/settings/billing/billing-panel";
import { SettingsPage } from "@/components/settings/settings-page";
import { ownerPage } from "@/lib/auth/owner-page";
import { billingView } from "@/modules/billing/service";

export const metadata = { title: "מנוי", robots: { index: false, follow: false } };

export default async function BillingPage() {
  const t = await getTranslations("billing");
  const { ctx, email } = await ownerPage();
  const view = await billingView(ctx);
  return (
    <SettingsPage email={email} title={t("title")} description={t("subtitle")}>
      <BillingPanel initial={view} timezone={ctx.business.timezone} />
    </SettingsPage>
  );
}
