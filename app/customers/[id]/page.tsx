import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { OwnerNav } from "@/components/owner/owner-nav";
import { PageHeader } from "@/components/patterns/page-header";
import { StatStrip } from "@/components/lab/dashboard/stat-strip";
import { ownerPage } from "@/lib/auth/owner-page";
import { ApiError } from "@/lib/api/http";
import { customerDetail } from "@/modules/customers/service";
import { formatMoney, STATUS_LABEL_HE, type StatusKey } from "@/modules/reports/metrics";
import { zonedParts } from "@/platform/clock";
import { z } from "zod";
import { AnonymizeCustomer } from "./anonymize";
import { NotesForm } from "./notes-form";

export const metadata = { title: "לקוח", robots: { index: false, follow: false } };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations("customers");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { ctx, email } = await ownerPage();
  let d;
  try {
    d = await customerDetail(ctx, id);
  } catch (e) {
    if (e instanceof ApiError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const tz = ctx.business.timezone;
  const when = (iso: string) => {
    const p = zonedParts(new Date(iso), tz);
    return `${p.date.split("-").reverse().join(".")} · ${String(Math.floor(p.minutes / 60)).padStart(2, "0")}:${String(p.minutes % 60).padStart(2, "0")}`;
  };
  const c = d.customer;
  const gone = c.anonymizedAt !== null;
  const isAdmin = ctx.role === "admin" || ctx.role === "owner";
  const name = gone ? t("anonymizedName") : c.fullName;

  return (
    <AppShell email={email} width="max-w-4xl" nav={<OwnerNav current="customers" />}>
      <Link href="/customers" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">{t("back")}</Link>
      <PageHeader title={name} description={gone ? t("detail.anonymizedNote") : t("detail.since", { date: c.createdAt.slice(0, 10).split("-").reverse().join(".") })} />
      {gone ? null : (
        <dl className="divide-y rounded-lg border bg-card text-sm">
          <div className="flex justify-between gap-4 p-4"><dt className="text-muted-foreground">{t("col.phone")}</dt><dd className="font-semibold"><bdi dir="ltr" data-testid="customer-phone">{c.phone}</bdi></dd></div>
          {c.email ? <div className="flex justify-between gap-4 p-4"><dt className="text-muted-foreground">{t("detail.email")}</dt><dd className="min-w-0 font-semibold [overflow-wrap:anywhere]"><bdi dir="ltr">{c.email}</bdi></dd></div> : null}
        </dl>
      )}
      <StatStrip
        stats={[
          { label: t("detail.visits"), value: String(d.stats.visits), hint: t("upcoming", { count: d.stats.upcoming }) },
          { label: t("detail.noShows"), value: String(d.stats.noShows), hint: t("noShows60", { count: d.stats.noShows60d }) },
          { label: t("detail.cancellations"), value: String(d.stats.cancellations), hint: "" },
          { label: t("detail.spent"), value: formatMoney(d.stats.spentCents), hint: "" },
        ]}
      />
      {gone ? null : <NotesForm id={c.id} initial={c.notes ?? ""} />}
      <section aria-labelledby="history" className="grid gap-3">
        <h2 id="history" className="text-lg font-semibold">{t("detail.history")}</h2>
        {d.appointments.length === 0 ? <p className="text-sm text-muted-foreground">{t("detail.historyEmpty")}</p> : (
          <ul className="divide-y rounded-lg border bg-card" data-testid="customer-history">
            {d.appointments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-4 text-sm">
                <div className="min-w-0"><p className="font-semibold">{a.service}</p><p className="text-muted-foreground tabular-nums">{when(a.startsAt)}</p></div>
                <div className="text-end"><p>{STATUS_LABEL_HE[a.status as StatusKey] ?? a.status}</p><p className="tabular-nums text-muted-foreground">{formatMoney(a.priceCents)}</p></div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {isAdmin && !gone ? <AnonymizeCustomer id={c.id} name={c.fullName} /> : null}
    </AppShell>
  );
}
