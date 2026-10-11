import { NextResponse } from "next/server";
import { CreateBookingRequest } from "@/lib/api/contracts";
import { api, fail, parse, readJson } from "@/lib/api/http";
import { normalizePhone } from "@/lib/phone";
import { clientIp, enforce, limitFromHeader } from "@/modules/booking/public/rate-limit";
import { catalogOr404 } from "@/modules/booking/public/resolve";
import { createBooking } from "@/modules/booking/public/service";

// Public booking (no session). Order matters: cheap limits first, then body validation, then the database decides conflicts.
export const POST = api<{ slug: string }>(async (req, { slug }) => {
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 128) throw fail("IDEMPOTENCY_KEY_REQUIRED", "חסר מפתח Idempotency-Key.");
  const ip = clientIp(req);
  await enforce([
    { scope: "book-ip", value: `${ip}|${slug}`, windowSeconds: 60, max: limitFromHeader(req, 10) },
    { scope: "book-biz", value: slug, windowSeconds: 60, max: 120 },
  ]);
  const catalog = await catalogOr404(slug);
  const input = parse(CreateBookingRequest, await readJson(req));
  const phone = normalizePhone(input.customer.phone);
  if (phone) await enforce([{ scope: "book-phone", value: `${phone}|${catalog.business.id}`, windowSeconds: 3600, max: 6 }]); // one customer cannot flood a business
  const { booking, replay } = await createBooking(catalog, input, key);
  return NextResponse.json({ booking }, { status: replay ? 200 : 201, headers: replay ? { "Idempotent-Replay": "true" } : {} });
}, { lab: false });
