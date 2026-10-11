import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { PublishButton } from "@/app/dashboard/publish-button";
import { PageHeader } from "@/components/patterns/page-header";
import { requireUser } from "@/lib/auth/session";
import { BUSINESS_KINDS, type BusinessKindId } from "@/modules/tenancy/business-kind";
import { listMyBusinesses } from "@/modules/tenancy/service";

// Auth is enforced in proxy.ts AND re-checked here (defense in depth, docs/05 §4.2). The real dashboard arrives in stage 5.
export default async function DashboardPage() {
  const t = await getTranslations("dashboard");
  const { supabase, claims } = await requireUser();
  const businesses = await listMyBusinesses(supabase);
  if (businesses.length === 0) redirect("/onboarding");
  const b = businesses[0];
  const host = process.env.NEXT_PUBLIC_SITE_HOST ?? "tori.example";

  return (
    <AppShell email={String(claims.email ?? "")}>
      <PageHeader title={t("welcome", { name: `\u2068${b.name}\u2069` })} description={t("placeholder")} />
      <dl className="divide-y rounded-lg border bg-card">
        <div className="flex flex-col gap-1 p-4 sm:flex-row sm:justify-between sm:gap-4">
          <dt className="text-muted-foreground">{t("kind")}</dt>
          <dd className="font-semibold" data-testid="biz-kind">{BUSINESS_KINDS[b.kind as BusinessKindId]?.label ?? b.kind}</dd>
        </div>
        <div className="flex flex-col gap-1 p-4 sm:flex-row sm:justify-between sm:gap-4">
          <dt className="text-muted-foreground">{t("linkLabel")}</dt>
          <dd className="min-w-0 font-semibold [overflow-wrap:anywhere]"><bdi data-testid="biz-link">{`${host}/book/${b.slug}`}</bdi></dd>
        </div>
        <div className="flex flex-col gap-1 p-4 sm:flex-row sm:justify-between sm:gap-4">
          <dt className="text-muted-foreground">{t("status")}</dt>
          <dd className="font-semibold" data-testid="biz-status">{b.published_at ? t("published") : t("draft")}</dd>
        </div>
      </dl>
      {b.published_at ? null : <PublishButton businessId={b.id} />}
      <Link href="/settings/security" className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">{t("security")}</Link>
    </AppShell>
  );
}
