import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell, WIDE } from "@/components/app-shell";
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
  const ts = await getTranslations("settings.nav");
  const supabase = await createClient();
  // First wave: the session/MFA/terms gate and the reads that do not depend on it run together.
  const [, businesses, owner, host] = await Promise.all([requireUser(), listMyBusinesses(supabase), ownerContext().catch(() => null), siteHost()]);
  if (businesses.length === 0 || !owner) redirect("/onboarding");
  const ctx = owner;
  const b = businesses[0];
  // Second wave: what needs the business id.
  const [billing, deletion] = await Promise.all([myBilling(ctx), deletionStatus(ctx)]);

  const settingsCards = [
    { href: "/settings/services", title: t("settingsServices"), desc: "ניהול שירותים, משכי טיפול ומחירים" },
    { href: "/settings/hours", title: t("settingsHours"), desc: "שעות פתיחה שבועיות, חגים וימים חריגים" },
    { href: "/settings/team", title: ts("team"), desc: "אנשי צוות, שעות עבודה ושיוך שירותים" },
    { href: "/settings/booking", title: ts("booking"), desc: "קישור ההזמנה, תנאי ביטול ומדיניות אי-הגעות" },
    { href: "/settings/billing", title: t("settingsBilling"), desc: "סטטוס תקופת הניסיון ומסלול המנוי" },
    { href: "/settings/account", title: ts("account"), desc: "ייצוא נתונים לאקסל וניהול החשבון" },
  ];

  return (
    <AppShell email={b.name} width={WIDE} nav={<OwnerNav current="calendar" />}>
      <DeletionBanner scheduledFor={deletion?.scheduledFor ?? null} timezone={ctx.business.timezone} />
      <BillingBanner billing={billing} timezone={ctx.business.timezone} />
      <PageHeader title={t("welcome", { name: `\u2068${b.name}\u2069` })} />
      <OwnerAgenda />
      <dl className="divide-y rounded-lg border bg-card">
        <div className="flex flex-col gap-1 p-4 sm:flex-row sm:justify-between sm:gap-4">
          <dt className="text-muted-foreground">{t("kind")}</dt>
          <dd className="font-semibold" data-testid="biz-kind">{BUSINESS_KINDS[b.kind as BusinessKindId]?.label ?? b.kind}</dd>
        </div>
        <div className="flex flex-col gap-1 p-4 sm:flex-row sm:justify-between sm:gap-4">
          <dt className="text-muted-foreground">{t("linkLabel")}</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-3 font-semibold [overflow-wrap:anywhere]">
            <a href={bookingUrl(host, b.slug)} target="_blank" rel="noopener" className="rounded-sm underline-offset-4 hover:underline"><bdi data-testid="biz-link">{`${host}/book/${b.slug}`}</bdi></a>
            <CopyLink url={bookingUrl(host, b.slug)} />
            <Link href="/settings/booking" className="inline-flex min-h-9 items-center text-xs font-normal text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" data-testid="change-link">{t("changeLink")}</Link>
          </dd>
        </div>
        {deletion ? (
          <div className="flex flex-col gap-1 p-4 sm:flex-row sm:justify-between sm:gap-4">
            <dt className="text-muted-foreground">{t("status")}</dt>
            <dd className="font-semibold" data-testid="biz-status">{t("closedForDeletion")}</dd>
          </div>
        ) : null}
      </dl>
      <section aria-label={t("settingsNav")} className="space-y-3 pt-2">
        <h2 className="text-base font-semibold text-foreground">{t("settingsNav")}</h2>
        <nav aria-label={t("settingsNav")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {settingsCards.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex flex-col justify-between rounded-lg border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/20"
            >
              <span className="text-sm font-semibold text-foreground group-hover:text-primary">{item.title}</span>
              <span className="mt-1 text-xs text-muted-foreground">{item.desc}</span>
            </Link>
          ))}
        </nav>
      </section>
    </AppShell>
  );
}
