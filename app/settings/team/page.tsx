import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { TeamManager } from "@/app/settings/team/team-manager";
import { SettingsPage } from "@/components/settings/settings-page";
import { requireUser } from "@/lib/auth/session";
import { rulesToDayHours } from "@/modules/availability/schema";
import { listServices } from "@/modules/catalog/service";
import { listTeam, loadServiceStaff, loadStaffRules } from "@/modules/team/repo";
import { listMyBusinesses } from "@/modules/tenancy/service";

export const metadata = { title: "צוות", robots: { index: false, follow: false } };

export default async function TeamPage() {
  const t = await getTranslations("settings.team");
  const { supabase, claims } = await requireUser();
  const business = (await listMyBusinesses(supabase))[0];
  if (!business) redirect("/onboarding");
  const [people, rules, serviceStaff, services] = await Promise.all([
    listTeam(supabase, business.id),
    loadStaffRules(supabase, business.id),
    loadServiceStaff(supabase, business.id),
    listServices(supabase, business.id),
  ]);
  return (
    <SettingsPage email={String(claims.email ?? "")} title={t("title")} description={t("subtitle")}>
      <TeamManager
        people={people.map((p) => ({ ...p, hours: rulesToDayHours(rules.get(p.id) ?? []) }))}
        services={services.filter((s) => s.active && s.capacity === 1).map((s) => ({ id: s.id, name: s.name, personIds: serviceStaff.get(s.id) ?? [] }))}
      />
    </SettingsPage>
  );
}
