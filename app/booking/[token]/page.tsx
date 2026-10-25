import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { confirmAttendanceWithToken, viewAppointment } from "@/modules/booking/public/service";

// The customer's link. GET only redirects: a valid link continues to the business' booking page with the customer's own appointment shown above the form
// (app/book/[slug]); an invalid one says so and shows nothing. Never cached; the pages say no-referrer so the link does not travel.
// Passing ?confirm=1 (or ?action=attend) confirms attendance directly upon clicking the confirmation button in the email.
export const dynamic = "force-dynamic";
export const metadata = { title: "ניהול התור", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function ManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ confirm?: string; action?: string }>;
}) {
  const { token } = await params;
  const sp = searchParams ? await searchParams : {};
  const shouldConfirm = sp.confirm === "1" || sp.confirm === "true" || sp.action === "attend";

  if (shouldConfirm) {
    await confirmAttendanceWithToken(token);
    const a = await viewAppointment(token);
    if (a) redirect(`/book/${a.businessSlug}?m=${encodeURIComponent(token)}&attended=1`);
  }

  const a = await viewAppointment(token);
  if (a) redirect(`/book/${a.businessSlug}?m=${encodeURIComponent(token)}`);
  const t = await getTranslations("manage");
  return (
    <main id="main" className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-2 px-4 text-center" data-testid="manage-invalid">
      <h1 className="text-2xl font-bold">{t("notFound")}</h1>
      <p className="text-muted-foreground">{t("notFoundHint")}</p>
      <Link href="/" className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-background px-5 text-sm font-semibold shadow-sm hover:bg-accent">
        {t("backHome")}
      </Link>
    </main>
  );
}
