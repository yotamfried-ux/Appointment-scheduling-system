import { appUrl } from "@/modules/notifications/config";
import { buildIcs } from "@/modules/calendar/ics";
import { resolveCatalog, viewAppointment } from "@/modules/booking/public/service";

// "Add to calendar" (CAL-05). Same capability link as the manage page; reading changes nothing. A cancelled, finished or unknown appointment is one generic 404.
export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const a = await viewAppointment(token);
  if (!a || (a.status !== "pending" && a.status !== "confirmed")) return notFound();
  const catalog = await resolveCatalog(a.businessSlug);
  const address = catalog.kind === "ok" ? catalog.catalog.business.address : "";
  const updated = new Date(a.updatedAt);
  const ics = buildIcs({
    uid: `${a.id}@${new URL(appUrl()).host}`,
    sequence: Math.floor(updated.getTime() / 1000), // seconds since 1970: only ever grows when the appointment changes (a move right after booking must still raise it)
    stamp: updated,
    start: new Date(a.startsAt),
    end: new Date(a.endsAt),
    summary: `${a.serviceName} · ${a.businessName}`,
    description: `${a.businessName}\n${a.serviceName}\nאסמכתא: ${a.reference}`,
    location: address || undefined,
    url: `${appUrl()}/book/${a.businessSlug}`, // the business's public page, never the private link
    status: a.status === "confirmed" ? "CONFIRMED" : "TENTATIVE",
    alarmMinutes: 60,
  });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="appointment.ics"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
