import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { WaitlistJoinForm } from "@/components/waitlist/join-form";
import { systemClock, zonedParts } from "@/platform/clock";
import { resolveCatalog } from "@/modules/booking/public/service";

// Join the waitlist for a full day. Unknown / unpublished / waitlist-off businesses are the same 404 as everywhere on the public surface.
export const dynamic = "force-dynamic";
export const metadata = { title: "רשימת המתנה", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function WaitlistJoinPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ service?: string }> }) {
  const { slug } = await params;
  const { service } = await searchParams;
  const t = await getTranslations("waitlist.join");
  const r = await resolveCatalog(slug);
  if (r.kind === "redirect") redirect(`/book/${r.slug}/waitlist`);
  if (r.kind !== "ok" || !r.catalog.business.waitlistEnabled) notFound();
  const c = r.catalog;
  return (
    <div className="min-h-svh">
      <header className="border-b bg-card/60"><div className="mx-auto flex h-14 max-w-lg items-center px-4"><Logo /></div></header>
      <main id="main" className="mx-auto grid w-full max-w-lg gap-6 px-4 py-8">
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]" data-testid="business-name">{c.business.name}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("lead")}</p>
        </div>
        <WaitlistJoinForm
          slug={c.business.slug}
          services={c.services.map((s) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes }))}
          initialService={c.services.some((s) => s.id === service) ? service! : ""}
          today={zonedParts(systemClock.now(), c.business.timezone).date}
          horizonDays={c.business.horizonDays}
        />
        <a href={`/book/${c.business.slug}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-2">{t("back")}</a>
      </main>
    </div>
  );
}
