import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BookingLinkForm } from "@/app/settings/booking/booking-link-form";
import { BookingRulesForm } from "@/app/settings/booking/booking-rules-form";
import { SettingsPage } from "@/components/settings/settings-page";
import { requireUser } from "@/lib/auth/session";
import { bookingUrl, siteHost } from "@/lib/site";
import { listMyBusinesses } from "@/modules/tenancy/service";
import type { BookingRules } from "@/modules/tenancy/booking-rules";

export const metadata = { title: "כללי הזמנה", robots: { index: false, follow: false } };

export default async function BookingSettingsPage() {
  const t = await getTranslations("settings.booking");
  const { supabase } = await requireUser();
  const [business, host] = await Promise.all([listMyBusinesses(supabase).then((b) => b[0]), siteHost()]);
  if (!business) redirect("/onboarding");
  const { data } = await supabase.from("businesses").select("requires_approval, cancel_until_hours, min_notice_minutes, booking_horizon_days, address, no_show_policy, no_show_threshold, block_message, attendance_alert_minutes, auto_complete_hours, digest_frequency, reschedule_service_change").eq("id", business.id).single();
  const initial: BookingRules = {
    requiresApproval: Boolean(data?.requires_approval),
    cancelUntilHours: data?.cancel_until_hours ?? 12,
    minNoticeMinutes: data?.min_notice_minutes ?? 60,
    horizonDays: data?.booking_horizon_days ?? 60,
    address: data?.address ?? "",
    noShowPolicy: (data?.no_show_policy ?? "off") as BookingRules["noShowPolicy"],
    noShowThreshold: data?.no_show_threshold ?? 3,
    blockMessage: data?.block_message ?? "",
    attendanceAlertMinutes: data?.attendance_alert_minutes ?? 0,
    autoCompleteHours: data?.auto_complete_hours ?? null,
    digestFrequency: (data?.digest_frequency ?? "off") as BookingRules["digestFrequency"],
    rescheduleServiceChange: Boolean(data?.reschedule_service_change),
  };
  return (
    <SettingsPage email={business.name} title={t("title")} description={t("subtitle")}>
      <div className="grid gap-10">
        <BookingLinkForm prefix={bookingUrl(host, "")} initial={business.slug} />
        <BookingRulesForm initial={initial} />
      </div>
    </SettingsPage>
  );
}
