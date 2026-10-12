import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LegalFooter } from "@/components/legal/legal-footer";
import { BookingFlow } from "@/components/lab/booking/booking-flow";
import { resolveCatalog, toServicesResponse } from "@/modules/booking/public/service";

// Public booking page (BKG-01/11, ACC-07): unknown/unpublished ⇒ 404; an old slug redirects to the current one.
export const metadata = { title: "קביעת תור", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await resolveCatalog(slug);
  if (r.kind === "redirect") redirect(`/book/${r.slug}`);
  if (r.kind !== "ok") notFound();
  if (!r.catalog.business.acceptingBookings) {
    const t = await getTranslations("billing.closed");
    return (
      <main id="main" className="mx-auto grid min-h-svh max-w-md content-center gap-3 px-4 py-10 text-center" data-testid="bookings-closed">
        <p className="text-sm text-muted-foreground">{r.catalog.business.name}</p>
        <h1 className="text-2xl font-bold tracking-tight text-balance">{t("title")}</h1>
        <p className="text-muted-foreground">{t("desc")}</p>
        {r.catalog.business.address ? <p className="text-sm"><span className="text-muted-foreground">{t("address")}: </span>{r.catalog.business.address}</p> : null}
      </main>
    );
  }
  return (
    <>
      <BookingFlow kind={r.catalog.business.kind} base={`/api/public/${r.catalog.business.slug}`} initialCatalog={toServicesResponse(r.catalog)} />
      <LegalFooter />
    </>
  );
}
