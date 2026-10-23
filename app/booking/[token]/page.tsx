import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { viewAppointment } from "@/modules/booking/public/service";

// The customer's link. GET only redirects: a valid link continues to the business' booking page with the customer's own appointment shown above the form
// (app/book/[slug]); an invalid one says so and shows nothing. Never cached; the pages say no-referrer so the link does not travel.
export const dynamic = "force-dynamic";
export const metadata = { title: "ניהול התור", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const a = await viewAppointment(token);
  if (a) redirect(`/book/${a.businessSlug}?m=${encodeURIComponent(token)}`);
  const t = await getTranslations("manage");
  return (
    <main id="main" className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-2 px-4 text-center" data-testid="manage-invalid">
      <h1 className="text-2xl font-bold">{t("notFound")}</h1>
      <p className="text-muted-foreground">{t("notFoundHint")}</p>
    </main>
  );
}
