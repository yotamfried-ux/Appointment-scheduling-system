import { notFound, redirect } from "next/navigation";
import { BookingFlow } from "@/components/lab/booking/booking-flow";
import { resolveCatalog } from "@/modules/booking/public/service";

// Public booking page (BKG-01/11, ACC-07): unknown/unpublished ⇒ 404; an old slug redirects to the current one.
export const metadata = { title: "קביעת תור", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await resolveCatalog(slug);
  if (r.kind === "redirect") redirect(`/book/${r.slug}`);
  if (r.kind !== "ok") notFound();
  return <BookingFlow kind={r.catalog.business.kind} base={`/api/public/${r.catalog.business.slug}`} />;
}
