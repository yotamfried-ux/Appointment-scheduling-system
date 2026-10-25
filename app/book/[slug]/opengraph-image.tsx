import { createSwissEditorialOgImage } from "@/lib/og/renderer";
import { resolveCatalog } from "@/modules/booking/public/service";

export const runtime = "nodejs";
export const alt = "קביעת תור אונליין";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await resolveCatalog(slug);
  const businessName = r.kind === "ok" ? r.catalog.business.name : "קביעת תור";

  return createSwissEditorialOgImage({
    brandInitial: businessName.charAt(0) || "D",
    brandName: businessName,
    brandSub: "זימון תורים אונליין · זמינות מיידית",
    heading: "קביעת תור עצמאית בקליק, ללא צורך בהתקנת אפליקציה.",
    sub: "בחרו שירות, מועד נוח וקבלו אישור מיידי ליומן ולמייל.",
    domain: `turim.d2ryf.com/book/${slug}`,
    footerRight: "ניהול יומן ותורים",
  });
}
