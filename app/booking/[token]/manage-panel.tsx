import { getTranslations } from "next-intl/server";
import { AttendButton } from "@/app/booking/[token]/attend-button";
import { CancelButton } from "@/app/booking/[token]/cancel-button";
import { formatDayLabel } from "@/lib/lab/booking-data";
import { priceLabel } from "@/lib/price";
import type { AppointmentView } from "@/modules/booking/public/service";
import { zonedParts } from "@/platform/clock";

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * The customer's own appointment, shown only to the holder of the link (the "view" token): on the business' booking page when it is opened with `?m=<token>`.
 * Cancel, reschedule and "I am coming" present that same token from the browser as POSTs; the page itself carries no other token (VULN-0022).
 */
export async function ManagePanel({ token, a }: { token: string; a: AppointmentView }) {
  const t = await getTranslations("manage");
  const start = zonedParts(new Date(a.startsAt), a.timezone);
  const active = a.status === "pending" || a.status === "confirmed";
  const cancelUntil = zonedParts(new Date(a.cancelUntil), a.timezone);
  const rows: { label: string; value: React.ReactNode; id?: string }[] = [
    { label: t("business"), value: a.businessName },
    { label: t("service"), value: a.serviceName },
    ...(a.personName && (a.teamSize ?? 0) >= 2 ? [{ label: t("person"), value: a.personName, id: "manage-person" }] : []),
    { label: t("when"), value: <>{formatDayLabel(start.date)} · <bdi>{hhmm(start.minutes)}</bdi></>, id: "when" },
    ...(priceLabel(a.priceMode, a.priceCents / 100) ? [{ label: t("price"), value: priceLabel(a.priceMode, a.priceCents / 100) }] : []),
    { label: t("status"), value: t(`statuses.${a.status as "confirmed"}`), id: "status" },
    { label: t("reference"), value: <bdi className="font-mono">{a.reference}</bdi>, id: "reference" },
  ];
  return (
    <section aria-labelledby="manage-title" className="mx-auto grid w-full max-w-lg gap-6 px-4 pt-6" data-testid="manage-panel">
        <h2 id="manage-title" className="text-2xl font-bold tracking-tight">{t("title")}</h2>
        <dl className="divide-y rounded-xl border bg-card">
          {rows.map(({ label, value, id }) => (
            <div key={label} className="flex flex-col gap-1 p-4 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold [overflow-wrap:anywhere]" data-testid={id ? `manage-${id}` : undefined}>{value}</dd>
            </div>
          ))}
        </dl>
        {active && a.movedByBusinessAt ? <p className="rounded-lg border border-info/40 bg-info-soft p-3 text-sm font-medium text-info-soft-foreground" data-testid="manage-moved">{t("movedByBusiness")}</p> : null}
        {a.canAttend ? <AttendButton token={token} /> : active && a.attendanceConfirmedAt ? <p className="rounded-lg border bg-card p-3 text-sm font-medium" data-testid="attend-confirmed">{t("attendConfirmed")}</p> : null}
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
        {active && a.canCancel ? (
          <>
            <p className="text-sm text-muted-foreground">{t("cancelUntil", { when: `${formatDayLabel(cancelUntil.date, "short")} ${hhmm(cancelUntil.minutes)}` })}</p>
            <CancelButton token={token} />
          </>
        ) : active ? (
          <p className="text-sm font-medium text-muted-foreground" data-testid="manage-too-late">{t("tooLate")}</p>
        ) : a.status === "cancelled_by_customer" ? (
          <section className="rounded-lg border bg-card p-4" data-testid="manage-cancelled">
            <h2 className="font-semibold">{t("cancelledTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("cancelledBody")}</p>
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">{t("already")}</p>
        )}
    </section>
  );
}
