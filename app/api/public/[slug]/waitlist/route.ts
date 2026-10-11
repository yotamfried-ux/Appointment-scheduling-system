import { NextResponse } from "next/server";
import { JoinWaitlistRequest } from "@/lib/api/contracts";
import { api, parse, readJson } from "@/lib/api/http";
import { normalizePhone } from "@/lib/phone";
import { clientIp, enforce, limitFromHeader } from "@/modules/booking/public/rate-limit";
import { catalogOr404 } from "@/modules/booking/public/resolve";
import { joinWaitlist } from "@/modules/waitlist/public";

// Join the waitlist for a full day (no session). Cheap limits first (WLT-08), then validation, then the database decides.
export const POST = api<{ slug: string }>(async (req, { slug }) => {
  const ip = clientIp(req);
  await enforce([
    { scope: "wl-ip", value: `${ip}|${slug}`, windowSeconds: 60, max: limitFromHeader(req, 10) },
    { scope: "wl-biz", value: slug, windowSeconds: 60, max: 120 },
  ]);
  const catalog = await catalogOr404(slug);
  const input = parse(JoinWaitlistRequest, await readJson(req));
  const phone = normalizePhone(input.customer.phone);
  if (phone) await enforce([{ scope: "wl-phone", value: `${phone}|${catalog.business.id}`, windowSeconds: 3600, max: 10 }]);
  const r = await joinWaitlist(catalog, input);
  return NextResponse.json(r, { status: r.replay ? 200 : 201, headers: r.replay ? { "Idempotent-Replay": "true" } : {} });
}, { lab: false });
