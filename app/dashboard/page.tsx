import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell, WIDE } from "@/components/app-shell";
import { PublishButton } from "@/app/dashboard/publish-button";
import { OwnerAgenda } from "@/components/owner/agenda";
import { BillingBanner } from "@/components/owner/billing-banner";
import { DeletionBanner } from "@/components/owner/deletion-banner";
import { deletionStatus } from "@/modules/account/service";
import { OwnerNav } from "@/components/owner/owner-nav";
import { PageHeader } from "@/components/patterns/page-header";
import { createClient } from "@/lib/supabase/server";
import { ownerContext } from "@/modules/booking/owner/service";
import { requireUser } from "@/lib/auth/session";
import { myBilling } from "@/modules/billing/entitlements";
import { CopyLink } from "@/components/owner/copy-link";
import { bookingUrl, siteHost } from "@/lib/site";
import { BUSINESS_KINDS, type BusinessKindId } from "@/modules/tenancy/business-kind";
import { listMyBusinesses } from "@/modules/tenancy/service";

// Auth is enforced in proxy.ts AND re-checked here (defense in depth, docs/05 §4.2). The agenda itself is fetched from /api/owner (RLS as the signed-in user).
export default async function DashboardPage() {
  const t = await getTranslations("dashboard");
  const supabase = await createClient();
  // First wave: the session/MFA/terms gate and the reads that do not depend on it run together (the gate redirects away if it fails; the reads are row-level-secured as the signed-in user, so nothing is exposed meanwhile).
  const [{ claims }, businesses, owner, host] = await Promise.all([requireUser(), listMyBusinesses(supabase), ownerContext().catch(() => null), siteHost()]);
  if (businesses.length === 0 || !owner) redirect("/onboarding");
  const ctx = owner;
  const b = businesses[0];
  // Second wave: what needs the business id.
  const [billing, deletion] = await Promise.all([myBilling(ctx), deletionStatus(ctx)]);

  return (
    <AppShell email={String(claims.email ?? "")} width={WIDE} nav={<OwnerNav current="calendar" />}>
      <DeletionBanner scheduledFor={deletion?.scheduledFor ?? null} timezone={ctx.business.timezone} />
      <BillingBanner billing={billing} timezone={ctx.business.timezone} />
      <PageHeader title={t("welcome", { name: `\u2068${b.name}\u2069` })} />
      {b.published_at || deletion ? null : <PublishButton businessId={b.id} />}
      <OwnerAgenda />
      <dl className="divide-y rounded-lg border bg-card">
        <div className="flex flex-col gap-1 p-4 sm:flex-row sm:justify-between sm:gap-4">
          <dt className="text-muted-foreground">{t("kind")}</dt>
          <dd className="font-semibold" data-testid="biz-kind">{BUSINESS_KINDS[b.kind as BusinessKindId]?.label ?? b.kind}</dd>
        </div>
        <div className="flex flex-col gap-1 p-4 sm:flex-row sm:justify-between sm:gap-4">
          <dt className="text-muted-foreground">{t("linkLabel")}</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-2 font-semibold [overflow-wrap:anywhere]">
            <a href={bookingUrl(host, b.slug)} target="_blank" rel="noopener" className="rounded-sm underline-offset-4 hover:underline"><bdi data-testid="biz-link">{`${host}/book/${b.slug}`}</bdi></a>
            <CopyLink url={bookingUrl(host, b.slug)} />
          </dd>
        </div>
        <div className="flex flex-col gap-1 p-4 sm:flex-row sm:justify-between sm:gap-4">
          <dt className="text-muted-foreground">{t("status")}</dt>
          <dd className="font-semibold" data-testid="biz-status">{deletion ? t("closedForDeletion") : b.published_at ? t("published") : t("draft")}</dd>
        </div>
      </dl>
      <nav aria-label={t("settingsNav")} className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-medium">
        {[["/settings/services", t("settingsServices")], ["/settings/hours", t("settingsHours")], ["/settings/billing", t("settingsBilling")], ["/settings/security", t("security")]].map(([href, label]) => (
          <Link key={href} href={href} className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">{label}</Link>
        ))}
      </nav>
    </AppShell>
  );
}
