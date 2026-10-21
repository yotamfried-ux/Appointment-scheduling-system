import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AccountPanel } from "@/app/settings/account/account-panel";
import { SettingsPage } from "@/components/settings/settings-page";
import { requireUser } from "@/lib/auth/session";
import { ownerPage } from "@/lib/auth/owner-page";
import { deletionStatus } from "@/modules/account/service";
import { zonedParts } from "@/platform/clock";

export const metadata = { title: "חשבון ונתונים", robots: { index: false, follow: false } };

export default async function AccountPage() {
  const t = await getTranslations("settings.account");
  const { claims } = await requireUser();
  const { ctx } = await ownerPage();
  if (!ctx) redirect("/onboarding");
  const pending = await deletionStatus(ctx);
  const date = pending ? zonedParts(new Date(pending.scheduledFor), ctx.business.timezone).date.split("-").reverse().join(".") : null;
  return (
    <SettingsPage email={String(claims.email ?? "")} title={t("title")} description={t("subtitle")}>
      <AccountPanel businessName={ctx.business.name} isOwner={ctx.role === "owner"} pendingDate={date} />
    </SettingsPage>
  );
}
