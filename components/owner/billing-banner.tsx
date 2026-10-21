import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { daysUntil, type MyBilling } from "@/modules/billing/entitlements";
import { zonedParts } from "@/platform/clock";

const fmt = (iso: string, tz: string) => zonedParts(new Date(iso), tz).date.split("-").reverse().join(".");

/** One calm line about the subscription, only when it needs attention (BIL-01/02/06). */
export async function BillingBanner({ billing, timezone }: { billing: MyBilling; timezone: string }) {
  const t = await getTranslations("billing.banner");
  let tone: "info" | "warning" | "danger" | null = null;
  let text = "";
  if (billing.state === "degraded") {
    tone = "danger";
    text = t("degraded");
  } else if (billing.state === "grace" && billing.graceUntil) {
    tone = "warning";
    text = `${t("graceTitle")} ${t("grace", { date: fmt(billing.graceUntil, timezone) })}`;
  } else if (billing.status === "canceled" && billing.currentPeriodEnd) {
    tone = "info";
    text = t("cancels", { date: fmt(billing.currentPeriodEnd, timezone) });
  } else if (billing.state === "trial" && billing.trialEndsAt) {
    const days = daysUntil(billing.trialEndsAt);
    if (days <= 7) {
      tone = "info";
      text = t("trial", { count: Math.max(days, 1) });
    }
  }
  if (!tone) return null;
  const styles = { info: "border-info/40 bg-info-soft text-info-soft-foreground", warning: "border-warning/40 bg-warning-soft text-warning-soft-foreground", danger: "border-destructive/40 bg-destructive-soft text-destructive-soft-foreground" }[tone];
  return (
    <div role="status" data-testid="billing-banner" data-state={billing.state} className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border px-4 py-3 text-sm font-medium ${styles}`}>
      <p>{text}</p>
      <Link href="/settings/billing" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">{t("action")}</Link>
    </div>
  );
}
