import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { HoursManager } from "@/app/settings/hours/hours-manager";
import { ServicePicker } from "@/app/settings/hours/service-picker";
import { SlotsPreview } from "@/app/settings/hours/slots-preview";
import { SettingsPage } from "@/components/settings/settings-page";
import { requireUser } from "@/lib/auth/session";
import { loadAvailability } from "@/modules/availability/repo";
import { rowsToExceptions, rowsToRules, rulesToDayHours } from "@/modules/availability/schema";
import Link from "next/link";
import { listServices } from "@/modules/catalog/service";
import { listTeam } from "@/modules/team/repo";
import { listMyBusinesses } from "@/modules/tenancy/service";
import { systemClock, zonedParts } from "@/platform/clock";

export const metadata = { title: "שעות פעילות", robots: { index: false, follow: false } };

export default async function HoursPage({ searchParams }: { searchParams: Promise<{ service?: string }> }) {
  const t = await getTranslations("settings");
  const { supabase } = await requireUser();
  const business = (await listMyBusinesses(supabase))[0];
  if (!business) redirect("/onboarding");
  const [{ rules, exceptions, resourceId }, services, tz, team] = await Promise.all([
    loadAvailability(supabase, business.id),
    listServices(supabase, business.id),
    supabase.from("businesses").select("timezone").eq("id", business.id).single(),
    listTeam(supabase, business.id),
  ]);
  const timeZone = String(tz.data?.timezone ?? "Asia/Jerusalem");
  const today = zonedParts(systemClock.now(), timeZone).date;
  const activePeople = team.filter((p) => p.active);
  const mine = team.find((p) => p.id === resourceId);
  const active = services.filter((s) => s.active);
  const wanted = (await searchParams).service;
  const picked = active.find((s) => s.id === wanted) ?? active[0];
  return (
    <SettingsPage email={business.name} title={t("hours.title")} description={t("hours.subtitle")}>
      {activePeople.length > 1 && mine ? (
        <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm" data-testid="hours-team-note">
          {t("hours.teamNote", { name: mine.name })} <Link href="/settings/team" className="font-semibold text-primary underline underline-offset-2">{t("hours.teamLink")}</Link>
        </p>
      ) : null}
      <HoursManager initial={rulesToDayHours(rules)} exceptions={exceptions} today={today} />
      <section aria-labelledby="preview-title" className="grid gap-4">
        <div>
          <h2 id="preview-title" className="text-lg font-semibold">{t("preview.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("preview.subtitle")}</p>
        </div>
        {picked ? (
          <>
            <ServicePicker services={active.map((s) => ({ id: s.id, name: s.name }))} value={picked.id} />
            <SlotsPreview
              rules={rowsToRules(rules)}
              exceptions={rowsToExceptions(exceptions)}
              timeZone={timeZone}
              clock={systemClock}
              service={{ durationMinutes: picked.duration_minutes, bufferMinutes: picked.buffer_minutes }}
            />
          </>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("preview.noServices")}</p>
        )}
      </section>
    </SettingsPage>
  );
}
