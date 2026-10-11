import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ServicesManager } from "@/app/settings/services/services-manager";
import { SettingsPage } from "@/components/settings/settings-page";
import { requireUser } from "@/lib/auth/session";
import { listServices } from "@/modules/catalog/service";
import { listMyBusinesses } from "@/modules/tenancy/service";

export const metadata = { title: "שירותים", robots: { index: false, follow: false } };

export default async function ServicesPage() {
  const t = await getTranslations("settings.services");
  const { supabase, claims } = await requireUser();
  const business = (await listMyBusinesses(supabase))[0];
  if (!business) redirect("/onboarding");
  const services = await listServices(supabase, business.id);
  return (
    <SettingsPage email={String(claims.email ?? "")} title={t("title")} description={t("subtitle")}>
      <ServicesManager services={services} />
    </SettingsPage>
  );
}
