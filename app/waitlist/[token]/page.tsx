import { getTranslations } from "next-intl/server";
import { WaitlistActions } from "@/app/waitlist/[token]/waitlist-actions";
import { Logo } from "@/components/brand/logo";
import { LegalFooter } from "@/components/legal/legal-footer";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatDayLabel } from "@/lib/lab/booking-data";
import { viewWaitlist } from "@/modules/waitlist/public";
import { zonedParts } from "@/platform/clock";

// The customer's private waitlist page (capability link). GET only shows; each action is a single-use POST (Server Action). Never cached, never leaks the token.
export const dynamic = "force-dynamic";
export const metadata = { title: "רשימת המתנה", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default async function WaitlistPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("waitlist.page");
  const v = await viewWaitlist(token);
  if (!v) {
    return (
      <main id="main" className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-2 px-4 text-center" data-testid="waitlist-invalid">
        <h1 className="text-2xl font-bold">{t("invalid")}</h1>
        <p className="text-muted-foreground">{t("invalidHint")}</p>
      </main>
    );
  }
  const when = (iso: string) => {
    const p = zonedParts(new Date(iso), v.timezone);
    return `${formatDayLabel(p.date)} · ${hhmm(p.minutes)}`;
  };
  const expires = v.offer ? hhmm(zonedParts(new Date(v.offer.expiresAt), v.timezone).minutes) : null;
  const rows: { label: string; value: React.ReactNode; id?: string }[] = [
    { label: t("business"), value: v.businessName },
    { label: t("service"), value: v.serviceName },
    v.offer ? { label: t("when"), value: <bdi>{when(v.offer.slotStartsAt)}</bdi>, id: "offer-when" } : v.booking ? { label: t("when"), value: <bdi>{when(v.booking.startsAt)}</bdi>, id: "booked-when" } : { label: t("day"), value: formatDayLabel(v.onDate), id: "wl-day" },
    ...(!v.offer && !v.booking ? [{ label: t("window"), value: v.fromMinute === null || v.toMinute === null ? t("anyTime") : <bdi>{t("windowRange", { from: hhmm(v.fromMinute), to: hhmm(v.toMinute) })}</bdi> }] : []),
    ...(v.booking ? [{ label: t("reference"), value: <bdi className="font-mono">{v.booking.reference}</bdi>, id: "booked-reference" }] : []),
  ];
  const headline = v.offer ? "offer" : v.status === "booked" ? "booked" : v.status === "cancelled" ? "cancelled" : "waiting";
  return (
    <div className="min-h-svh">
      <header className="border-b bg-card/60"><div className="mx-auto flex h-14 max-w-lg items-center px-4"><Logo /></div></header>
      <main id="main" className="mx-auto grid w-full max-w-lg gap-6 px-4 py-8">
        <div className="grid gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="wl-headline">{t(`${headline}.title`)}</h1>
            <StatusBadge status={v.status === "booked" ? "confirmed" : v.status === "cancelled" ? "cancelled" : "pending"} label={t(`statuses.${v.offer ? "offered" : v.status}`)} />
          </div>
          <p className="text-muted-foreground">{headline === "offer" ? t("offer.body", { time: expires ?? "" }) : t(`${headline}.body`)}</p>
        </div>
        <dl className="divide-y rounded-xl border bg-card">
          {rows.map(({ label, value, id }) => (
            <div key={label} className="flex flex-col gap-1 p-4 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold [overflow-wrap:anywhere]" data-testid={id}>{value}</dd>
            </div>
          ))}
        </dl>
        <WaitlistActions tokens={v.tokens} offerActive={Boolean(v.offer)} canLeave={v.status === "waiting" || v.status === "offered"} />
      </main>
      <LegalFooter />
    </div>
  );
}
