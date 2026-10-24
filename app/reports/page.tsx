import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AppShell, WIDE } from "@/components/app-shell";
import { BarChart, type BarPoint } from "@/components/charts/bar-chart";
import { StatStrip } from "@/components/lab/dashboard/stat-strip";
import { OwnerNav } from "@/components/owner/owner-nav";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ownerPage } from "@/lib/auth/owner-page";
import { myBilling } from "@/modules/billing/entitlements";
import { IsoDate } from "@/lib/api/contracts";
import { formatDayLabel } from "@/lib/lab/booking-data";
import { formatMoney, formatPercent, resolvePeriod, type Preset } from "@/modules/reports/metrics";
import { MAX_RANGE_DAYS, report, requireAdmin } from "@/modules/reports/service";
import { systemClock, zonedParts } from "@/platform/clock";

export const metadata = { title: "דוחות", robots: { index: false, follow: false } };

const PRESETS: Preset[] = ["7d", "30d", "90d", "month", "lastMonth"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const shortDate = (d: string) => `${Number(d.slice(8))}.${Number(d.slice(5, 7))}`;
const dayMs = 86_400_000;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations("reports");
  const { ctx, email } = await ownerPage();
  const sp = await searchParams;
  const today = zonedParts(systemClock.now(), ctx.business.timezone).date;

  const presetRaw = one(sp.preset);
  const preset = (PRESETS as string[]).includes(presetRaw ?? "") ? (presetRaw as Preset) : undefined;
  const f = IsoDate.safeParse(one(sp.from));
  const to = IsoDate.safeParse(one(sp.to));
  let period = resolvePeriod(today, preset ?? "30d");
  let custom = false;
  let rangeError = false;
  if (!preset && (f.success || to.success)) {
    custom = true;
    if (f.success && to.success && f.data <= to.data && (Date.parse(to.data) - Date.parse(f.data)) / dayMs < MAX_RANGE_DAYS) period = { from: f.data, to: to.data };
    else rangeError = true; // fall back to the default period and say so
  }

  const [r, billing] = await Promise.all([report(ctx, period.from, period.to), myBilling(ctx)]);
  const up = await getTranslations("billing.upsell");
  const k = r.kpis;
  const isAdmin = (() => { try { requireAdmin(ctx); return true; } catch { return false; } })();
  const empty = k.appointments === 0 && k.cancelled === 0 && k.pending === 0;
  const wd = t.raw("weekdays") as string[];
  const dayLabel = (d: string) => `${wd[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${shortDate(d)}`;

  const apptPoints: BarPoint[] = r.byDay.map((d) => ({ label: shortDate(d.date), value: d.appointments, text: `${dayLabel(d.date)} · ${d.appointments}` }));
  const revPoints: BarPoint[] = r.byDay.map((d) => ({ label: shortDate(d.date), value: d.revenueCents, text: `${dayLabel(d.date)} · ${formatMoney(d.revenueCents)}` }));
  const wdPoints: BarPoint[] = r.byWeekday.map((n, i) => ({ label: wd[i], value: n, text: `${wd[i]} · ${n}` }));

  return (
    <AppShell email={email} width={WIDE} nav={<OwnerNav current="reports" />}>
      <PageHeader title={t("title")} description={t("subtitle")} />

      <section aria-label={t("period")} className="grid gap-4 rounded-lg border bg-card p-4 lg:grid-cols-[1fr_auto] lg:items-end">
        <ul className="flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const active = !custom && (preset ?? "30d") === p;
            return (
              <li key={p}>
                <Link
                  href={`/reports?preset=${p}`}
                  aria-current={active ? "true" : undefined}
                  data-testid={`preset-${p}`}
                  className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
                >
                  {t(`presets.${p}`)}
                </Link>
              </li>
            );
          })}
        </ul>
        <form method="get" action="/reports" className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">{t("from")}</span>
            <Input type="date" name="from" dir="ltr" className="h-11 w-full px-2.5 text-start text-sm sm:w-auto sm:px-3.5 sm:text-base" defaultValue={period.from} data-testid="range-from" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">{t("to")}</span>
            <Input type="date" name="to" dir="ltr" className="h-11 w-full px-2.5 text-start text-sm sm:w-auto sm:px-3.5 sm:text-base" defaultValue={period.to} data-testid="range-to" />
          </label>
          <Button type="submit" variant="outline" className="col-span-2 sm:col-span-1" data-testid="range-apply">{t("apply")}</Button>
        </form>
        {rangeError ? <p role="alert" className="text-sm lg:col-span-2 font-medium text-destructive" data-testid="range-error">{t("rangeError")}</p> : null}
        <p className="text-xs text-muted-foreground lg:col-span-2" data-testid="range-shown">
          <bdi>{formatDayLabel(period.from, "date")}</bdi> – <bdi>{formatDayLabel(period.to, "date")}</bdi>
        </p>
      </section>

      {empty ? (
        <EmptyState icon={<BarChart3 className="size-6" />} title={t("emptyTitle")} description={t("emptyDesc")} className="" />
      ) : (
        <>
          <div className="grid gap-4" data-testid="kpis">
            <StatStrip
              stats={[
                { label: t("kpi.appointments"), value: String(k.appointments), hint: t("kpi.appointmentsHint") },
                { label: t("kpi.revenue"), value: formatMoney(k.revenueCents), hint: t("kpi.revenueHint") },
                { label: t("kpi.expected"), value: formatMoney(k.expectedCents), hint: t("kpi.expectedHint") },
                { label: t("kpi.avgTicket"), value: k.avgTicketCents === null ? "—" : formatMoney(Math.round(k.avgTicketCents)), hint: t("kpi.avgTicketHint") },
              ]}
            />
            <StatStrip
              stats={[
                { label: t("kpi.noShowRate"), value: formatPercent(k.noShowRate), hint: t("kpi.noShowRateHint") },
                { label: t("kpi.cancelRate"), value: formatPercent(k.cancellationRate), hint: t("kpi.cancelRateHint") },
                { label: t("kpi.newCustomers"), value: String(k.newCustomers), hint: t("kpi.newCustomersHint") },
                { label: t("kpi.returning"), value: String(k.returningCustomers), hint: t("kpi.returningHint") },
              ]}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <BarChart title={t("chartAppointments")} description={t("chartDesc")} points={apptPoints} tableHeaders={[t("period"), t("kpi.appointments")]} testId="chart-appointments" />
            <BarChart title={t("chartRevenue")} description={t("chartDesc")} points={revPoints} tableHeaders={[t("period"), t("kpi.revenue")]} testId="chart-revenue" />
          </div>
          <section aria-labelledby="by-service" className="grid gap-3">
            <h2 id="by-service" className="text-lg font-semibold">{t("services")}</h2>
            <ul className="divide-y rounded-lg border bg-card sm:hidden" data-testid="by-service-cards">
              {r.byService.map((s) => (
                <li key={s.service} className="grid gap-1 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 font-semibold">{s.service}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{formatMoney(s.revenueCents)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {t("svc.appointments")} {s.appointments} · {t("svc.completed")} {s.completed} · {t("svc.noShows")} {s.noShows} · {t("svc.cancelled")} {s.cancelled}
                  </p>
                </li>
              ))}
            </ul>
            <div className="hidden rounded-lg border bg-card sm:block">
              <table className="w-full text-sm" data-testid="by-service">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-start font-medium">{t("svc.name")}</th>
                    <th scope="col" className="px-4 py-3 text-start font-medium">{t("svc.appointments")}</th>
                    <th scope="col" className="px-4 py-3 text-start font-medium">{t("svc.completed")}</th>
                    <th scope="col" className="px-4 py-3 text-start font-medium">{t("svc.noShows")}</th>
                    <th scope="col" className="px-4 py-3 text-start font-medium">{t("svc.cancelled")}</th>
                    <th scope="col" className="px-4 py-3 text-start font-medium">{t("svc.revenue")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y tabular-nums">
                  {r.byService.map((s) => (
                    <tr key={s.service} data-testid="service-row">
                      <th scope="row" className="px-4 py-3 text-start font-medium">{s.service}</th>
                      <td className="px-4 py-3">{s.appointments}</td>
                      <td className="px-4 py-3">{s.completed}</td>
                      <td className="px-4 py-3">{s.noShows}</td>
                      <td className="px-4 py-3">{s.cancelled}</td>
                      <td className="px-4 py-3">{formatMoney(s.revenueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <BarChart title={t("chartWeekday")} points={wdPoints} tableHeaders={[t("period"), t("kpi.appointments")]} testId="chart-weekday" />
          <p className="text-xs text-muted-foreground">{t("definitions")}</p>
        </>
      )}

      {isAdmin ? (
        <section aria-labelledby="export" className="grid gap-3 rounded-lg border bg-card p-4">
          <div>
            <h2 id="export" className="text-lg font-semibold">{t("export.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("export.desc")}</p>
          </div>
          {!billing.features.export ? (
            <div className="grid gap-1 rounded-md bg-warning-soft p-3 text-sm text-warning-soft-foreground" data-testid="export-upsell">
              <p className="font-semibold">{up("title", { feature: up("export") })}</p>
              <p>{up("desc")}</p>
              <Link href="/settings/billing" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">{up("action")}</Link>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><a href={`/api/owner/export/appointments?from=${period.from}&to=${period.to}&format=xlsx`} data-testid="export-appointments" download>{t("export.appointments")}</a></Button>
              <Button asChild variant="outline"><a href="/api/owner/export/customers?format=xlsx" data-testid="export-customers" download>{t("export.customers")}</a></Button>
            </div>
          )}
        </section>
      ) : null}
    </AppShell>
  );
}
