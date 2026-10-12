import { getTranslations } from "next-intl/server";
import { CancelButton } from "@/app/booking/[token]/cancel-button";
import { Logo } from "@/components/brand/logo";
import { LegalFooter } from "@/components/legal/legal-footer";
import { formatDayLabel, formatPrice } from "@/lib/lab/booking-data";
import { viewAppointment } from "@/modules/booking/public/service";
import { zonedParts } from "@/platform/clock";

// Customer's private page (capability link). GET only shows; cancelling is a POST (Server Action). Never cached, never leaks the token via Referer.
export const dynamic = "force-dynamic";
export const metadata = { title: "ניהול התור", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("manage");
  const a = await viewAppointment(token);
  if (!a) {
    return (
      <main id="main" className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-2 px-4 text-center" data-testid="manage-invalid">
        <h1 className="text-2xl font-bold">{t("notFound")}</h1>
        <p className="text-muted-foreground">{t("notFoundHint")}</p>
      </main>
    );
  }
  const start = zonedParts(new Date(a.startsAt), a.timezone);
  const active = a.status === "pending" || a.status === "confirmed";
  const cancelUntil = zonedParts(new Date(a.cancelUntil), a.timezone);
  const rows: { label: string; value: React.ReactNode; id?: string }[] = [
    { label: t("business"), value: a.businessName },
    { label: t("service"), value: a.serviceName },
    { label: t("when"), value: <>{formatDayLabel(start.date)} · <bdi>{hhmm(start.minutes)}</bdi></>, id: "when" },
    { label: t("price"), value: formatPrice(a.priceCents / 100) },
    { label: t("status"), value: t(`statuses.${a.status as "confirmed"}`), id: "status" },
    { label: t("reference"), value: <bdi className="font-mono">{a.reference}</bdi>, id: "reference" },
  ];
  return (
    <div className="min-h-svh">
      <header className="border-b bg-card/60"><div className="mx-auto flex h-14 max-w-lg items-center px-4"><Logo /></div></header>
      <main id="main" className="mx-auto grid w-full max-w-lg gap-6 px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <dl className="divide-y rounded-xl border bg-card">
          {rows.map(({ label, value, id }) => (
            <div key={label} className="flex flex-col gap-1 p-4 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold [overflow-wrap:anywhere]" data-testid={id ? `manage-${id}` : undefined}>{value}</dd>
            </div>
          ))}
        </dl>
        {active ? (
          <div className="grid gap-1">
            <a href={`/booking/${token}/calendar`} download className="inline-flex min-h-11 w-full items-center justify-center rounded-md border px-4 text-sm font-semibold hover:bg-accent" data-testid="manage-add-to-calendar">{t("addToCalendar")}</a>
            <p className="text-xs text-muted-foreground">{t("addToCalendarHint")}</p>
          </div>
        ) : null}
        {active && a.canReschedule ? (
          <div className="grid gap-1">
            <a href={`/booking/${token}/reschedule`} className="inline-flex min-h-11 w-full items-center justify-center rounded-md border px-4 text-sm font-semibold hover:bg-accent" data-testid="manage-reschedule">{t("reschedule")}</a>
            <p className="text-xs text-muted-foreground">{t("rescheduleHint")}</p>
          </div>
        ) : null}
        {active && a.canCancel && a.cancelToken ? (
          <>
            <p className="text-sm text-muted-foreground">{t("cancelUntil", { when: `${formatDayLabel(cancelUntil.date, "short")} ${hhmm(cancelUntil.minutes)}` })}</p>
            <CancelButton cancelToken={a.cancelToken} />
          </>
        ) : active ? (
          <p className="text-sm font-medium text-muted-foreground" data-testid="manage-too-late">{t("tooLate")}</p>
        ) : a.status === "cancelled_by_customer" ? (
          <section className="rounded-lg border bg-card p-4" data-testid="manage-cancelled">
            <h2 className="font-semibold">{t("cancelledTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("cancelledBody")}</p>
            <a href={`/book/${a.businessSlug}`} className="mt-3 inline-block text-sm font-semibold text-primary underline underline-offset-2">{t("book")}</a>
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">{t("already")}</p>
        )}
      </main>
      <LegalFooter />
    </div>
  );
}
