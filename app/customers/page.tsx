import Link from "next/link";
import { Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AppShell, WIDE } from "@/components/app-shell";
import { OwnerNav } from "@/components/owner/owner-nav";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ownerPage } from "@/lib/auth/owner-page";
import { myBilling } from "@/modules/billing/entitlements";
import { listCustomers, SORTS, type CustomerSort } from "@/modules/customers/service";
import { formatMoney } from "@/modules/reports/metrics";
import { zonedParts } from "@/platform/clock";

export const metadata = { title: "לקוחות", robots: { index: false, follow: false } };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations("customers");
  const { ctx, email } = await ownerPage();
  const sp = await searchParams;
  const q = (one(sp.q) ?? "").slice(0, 80);
  const sort = (SORTS as readonly string[]).includes(one(sp.sort) ?? "") ? (one(sp.sort) as CustomerSort) : "last_visit";
  const filter = (["missing_email", "duplicates"] as const).find((f) => f === one(sp.filter));
  const page = Math.min(10_000, Math.max(1, Math.floor(Number(one(sp.page))) || 1));
  const mayExport = ctx.role === "admin" || ctx.role === "owner";
  const [list, billing] = await Promise.all([
    listCustomers(ctx, { q, sort, page, filter }),
    mayExport ? myBilling(ctx) : null,
  ]);
  const day = (iso: string) => zonedParts(new Date(iso), ctx.business.timezone).date.split("-").reverse().join(".");
  const href = (p: number) => `/customers?${new URLSearchParams({ ...(q ? { q } : {}), ...(filter ? { filter } : {}), sort, page: String(p) })}`;
  const filterHref = (f?: string) => `/customers?${new URLSearchParams({ ...(q ? { q } : {}), ...(f ? { filter: f } : {}), sort })}`;
  const isAdmin = mayExport && Boolean(billing?.features.export);

  return (
    <AppShell email={email} width={WIDE} nav={<OwnerNav current="customers" />}>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={isAdmin ? <Button asChild variant="outline"><a href="/api/owner/export/customers?format=xlsx" download data-testid="export-customers">{t("export")}</a></Button> : undefined}
      />
      <div className="space-y-3">
        <form method="get" action="/customers" role="search" className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
          {filter ? <input type="hidden" name="filter" value={filter} /> : null}
          <label className="grid min-w-0 flex-1 gap-1 text-sm basis-56">
            <span className="text-muted-foreground">{t("searchLabel")}</span>
            <Input type="search" name="q" defaultValue={q} maxLength={80} placeholder={t("searchPlaceholder")} className="h-11" data-testid="customer-search" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">{t("sortLabel")}</span>
            <NativeSelect name="sort" defaultValue={sort} className="w-auto" data-testid="customer-sort">
              {SORTS.map((s) => <option key={s} value={s}>{t(`sort.${s}`)}</option>)}
            </NativeSelect>
          </label>
          <Button type="submit" data-testid="customer-search-go">{t("searchButton")}</Button>
          {q || filter ? <Button asChild variant="ghost"><Link href={`/customers?sort=${sort}`}>{t("clear")}</Link></Button> : null}
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant={!filter ? "secondary" : "ghost"} className="h-8 text-xs font-medium">
            <Link href={filterHref()}>כל הלקוחות</Link>
          </Button>
          <Button asChild size="sm" variant={filter === "missing_email" ? "secondary" : "ghost"} className="h-8 text-xs font-medium">
            <Link href={filterHref("missing_email")}>ללא כתובת אימייל</Link>
          </Button>
          <Button asChild size="sm" variant={filter === "duplicates" ? "secondary" : "ghost"} className="h-8 text-xs font-medium">
            <Link href={filterHref("duplicates")}>כפילויות אפשריות</Link>
          </Button>
        </div>
      </div>

      {list.total === 0 ? (
        q || filter ? <EmptyState icon={<Users className="size-6" />} title={t("noResultsTitle")} description={t("noResultsDesc")} />
          : <EmptyState icon={<Users className="size-6" />} title={t("emptyTitle")} description={t("emptyDesc")} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="customer-count">{t("count", { count: list.total })}</p>
          <div className="overflow-hidden rounded-lg border bg-card">
          <div aria-hidden className="hidden gap-2 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <span>{t("col.name")}</span><span>{t("col.visits")}</span><span>{t("col.lastVisit")}</span><span>{t("col.spent")}</span>
          </div>
          <ul className="divide-y" data-testid="customer-list">
            {list.items.map((c) => (
              <li key={c.id}>
                <Link href={`/customers/${c.id}`} className="grid gap-2 p-4 hover:bg-accent/50 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center" data-testid="customer-row">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{c.anonymized ? t("anonymizedName") : c.fullName}</p>
                    <p className="text-sm text-muted-foreground">{c.anonymized ? "" : <bdi dir="ltr">{c.phone}</bdi>}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {c.upcoming > 0 ? <Badge variant="secondary">{t("upcoming", { count: c.upcoming })}</Badge> : null}
                      {c.noShows60d > 0 ? <Badge className="bg-destructive-soft text-destructive-soft-foreground">{t("noShows60", { count: c.noShows60d })}</Badge> : null}
                      {!c.email && !c.anonymized ? <Badge variant="outline" className="border-dashed text-muted-foreground text-[10px]">חסר אימייל</Badge> : null}
                      {c.anonymized ? <Badge variant="outline">{t("anonymized")}</Badge> : null}
                    </div>
                  </div>
                  <p className="text-sm"><span className="text-muted-foreground sm:sr-only">{t("col.visits")}: </span><span className="tabular-nums">{c.visits}</span></p>
                  <p className="text-sm"><span className="text-muted-foreground sm:sr-only">{t("col.lastVisit")}: </span>{c.lastVisit ? day(c.lastVisit) : t("never")}</p>
                  <p className="text-sm tabular-nums"><span className="text-muted-foreground sm:sr-only">{t("col.spent")}: </span>{formatMoney(c.spentCents)}</p>
                </Link>
              </li>
            ))}
          </ul>
          </div>
          {list.pages > 1 ? (
            <nav aria-label={t("pageOf", { page: list.page, pages: list.pages })} className="flex items-center justify-between gap-3">
              {list.page > 1 ? <Button asChild variant="outline"><Link href={href(list.page - 1)} rel="prev">{t("prev")}</Link></Button> : <span />}
              <span className="text-sm text-muted-foreground" data-testid="customer-page">{t("pageOf", { page: list.page, pages: list.pages })}</span>
              {list.page < list.pages ? <Button asChild variant="outline"><Link href={href(list.page + 1)} rel="next">{t("next")}</Link></Button> : <span />}
            </nav>
          ) : null}
        </>
      )}
    </AppShell>
  );
}
