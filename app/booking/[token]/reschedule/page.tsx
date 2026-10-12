import { getTranslations } from "next-intl/server";
import { RescheduleForm } from "@/app/booking/[token]/reschedule/reschedule-form";
import { Logo } from "@/components/brand/logo";
import { LegalFooter } from "@/components/legal/legal-footer";
import { formatDayLabel } from "@/lib/lab/booking-data";
import { resolveCatalog, viewAppointment } from "@/modules/booking/public/service";
import { zonedParts } from "@/platform/clock";

// RSC-01/02. GET only shows the picker; the move itself is a POST (Server Action) with a single-use token.
export const dynamic = "force-dynamic";
export const metadata = { title: "שינוי מועד", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function ReschedulePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("reschedule");
  const a = await viewAppointment(token);
  if (!a) {
    return (
      <main id="main" className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-2 px-4 text-center" data-testid="manage-invalid">
        <h1 className="text-2xl font-bold">{t("notFound")}</h1>
      </main>
    );
  }
  // RSC-03: other services are offered only when the business allows changing the service while moving
  const catalog = a.serviceChangeAllowed ? await resolveCatalog(a.businessSlug) : null;
  const services = catalog?.kind === "ok" ? catalog.catalog.services.map((s) => ({ id: s.id, name: s.name })) : [];
  const start = zonedParts(new Date(a.startsAt), a.timezone);
  const hhmm = `${String(Math.floor(start.minutes / 60)).padStart(2, "0")}:${String(start.minutes % 60).padStart(2, "0")}`;
  return (
    <div className="min-h-svh">
      <header className="border-b bg-card/60"><div className="mx-auto flex h-14 max-w-lg items-center px-4"><Logo /></div></header>
      <main id="main" className="mx-auto grid w-full max-w-lg gap-6 px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        {a.canReschedule && a.rescheduleToken ? (
          <>
            <p className="text-muted-foreground" data-testid="resched-current">{t("current", { service: a.serviceName, when: `${formatDayLabel(start.date)} · ${hhmm}` })}</p>
            <RescheduleForm slug={a.businessSlug} serviceId={a.serviceId} services={services} initialToken={a.rescheduleToken} manageHref={`/booking/${token}`} />
          </>
        ) : (
          <section className="grid gap-3" data-testid="resched-closed">
            <p className="text-muted-foreground">{a.rescheduledCount >= 3 ? t("limit") : t("tooLate")}</p>
            <a href={`/booking/${token}`} className="inline-flex min-h-11 w-fit items-center font-semibold text-primary underline underline-offset-2">{t("back")}</a>
          </section>
        )}
      </main>
      <LegalFooter />
    </div>
  );
}
