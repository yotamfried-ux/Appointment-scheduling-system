import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { zonedParts } from "@/platform/clock";

/** ACC-09: while a deletion is scheduled the owner sees it on every dashboard load, with the way back. */
export async function DeletionBanner({ scheduledFor, timezone }: { scheduledFor: string | null; timezone: string }) {
  if (!scheduledFor) return null;
  const t = await getTranslations("settings.account.banner");
  const date = zonedParts(new Date(scheduledFor), timezone).date.split("-").reverse().join(".");
  return (
    <div role="status" data-testid="deletion-banner" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-destructive/40 bg-destructive-soft px-4 py-3 text-sm font-medium text-destructive-soft-foreground">
      <p>{t("text", { date })}</p>
      <Link href="/settings/account" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">{t("action")}</Link>
    </div>
  );
}
