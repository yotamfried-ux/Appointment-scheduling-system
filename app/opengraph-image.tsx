import { createSwissEditorialOgImage } from "@/lib/og/renderer";

export const runtime = "nodejs";
export const alt = "ניהול יומן ותורים · לבעלי עסקים ונותני שירות";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return createSwissEditorialOgImage({
    brandInitial: "D",
    brandName: "ניהול יומן ותורים",
    brandSub: "לבעלי עסקים ונותני שירות עצמאיים",
    heading: "מערכת קביעת תורים מדויקת, שקטה וללא עמלות נסתרות.",
    sub: "דף הזמנות פרטי, סנכרון לוחות שנה והודעות ישירות ללקוחות.",
    domain: "turim.d2ryf.com",
    footerRight: "ניהול יומן ותורים",
  });
}
