import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LegalFooter } from "@/components/legal/legal-footer";
import { ReportBusiness } from "@/components/legal/report-business";
import { BookingFlow } from "@/components/lab/booking/booking-flow";
import { ManagePanel } from "@/app/booking/[token]/manage-panel";
import { resolveCatalog, toServicesResponse, viewAppointment } from "@/modules/booking/public/service";
import { BRAND } from "@/config/brand";

// Public booking page (BKG-01/11, ACC-07): unknown/unpublished ⇒ 404; an old slug redirects to the current one.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const r = await resolveCatalog(slug);
  if (r.kind !== "ok") {
    return { title: "קביעת תור", robots: { index: false, follow: false }, referrer: "no-referrer" };
  }
  const businessName = r.catalog.business.name;
  const title = `קביעת תור ב${businessName}`;
  const description = `קביעת תור עצמאית ב${businessName} בקליק, ללא צורך בהתקנת אפליקציה. בחרו שירות ומועד נוח.`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    openGraph: {
      type: "website",
      locale: "he_IL",
      siteName: BRAND.name,
      title,
      description,
      url: `/book/${slug}`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function BookPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ m?: string | string[]; attended?: string }> }) {
  const { slug } = await params;
  const { m, attended } = await searchParams;
  const token = typeof m === "string" ? m : undefined;
  const r = await resolveCatalog(slug);
  if (r.kind === "redirect") redirect(`/book/${r.slug}${token ? `?m=${encodeURIComponent(token)}${attended ? `&attended=${attended}` : ""}` : ""}`);
  if (r.kind !== "ok") notFound();

  const h = await headers();
  const nonce = h.get("x-nonce") ?? undefined;
  const businessJsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: r.catalog.business.name,
    url: `https://turim.d2ryf.com/book/${r.catalog.business.slug}`,
    ...(r.catalog.business.address ? { address: r.catalog.business.address } : {}),
  };

  // The customer's link: their own appointment is shown above the form, and only if the link is valid and belongs to THIS business. Anything else shows the plain form (nothing is revealed).
  const mine = token ? await viewAppointment(token) : null;
  const panel = mine && mine.businessSlug === r.catalog.business.slug && token ? <ManagePanel token={token} a={mine} attended={attended === "1"} /> : null;
  if (!r.catalog.business.acceptingBookings) {
    const t = await getTranslations("billing.closed");
    return (
      <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(businessJsonLd) }}
      />
      {panel}
      <main id="main" className="mx-auto grid min-h-svh max-w-md content-center gap-3 px-4 py-10 text-center" data-testid="bookings-closed">
        <p className="text-sm text-muted-foreground">{r.catalog.business.name}</p>
        <h1 className="text-2xl font-bold tracking-tight text-balance">{t("title")}</h1>
        <p className="text-muted-foreground">{t("desc")}</p>
        {r.catalog.business.address ? <p className="text-sm"><span className="text-muted-foreground">{t("address")}: </span>{r.catalog.business.address}</p> : null}
      </main>
      </>
    );
  }
  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(businessJsonLd) }}
      />
      {panel}
      <BookingFlow kind={r.catalog.business.kind} base={`/api/public/${r.catalog.business.slug}`} initialCatalog={toServicesResponse(r.catalog)} />
      <ReportBusiness slug={r.catalog.business.slug} />
      <LegalFooter />
    </>
  );
}
