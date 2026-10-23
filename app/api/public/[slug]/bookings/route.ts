import { after, NextResponse } from "next/server";
import { CreateBookingRequest } from "@/lib/api/contracts";
import { api, fail, parse, readJson } from "@/lib/api/http";
import { normalizePhone } from "@/lib/phone";
import { clientIp, emailLimit, enforce, limitFromHeader } from "@/modules/booking/public/rate-limit";
import { catalogOr404 } from "@/modules/booking/public/resolve";
import { createBooking } from "@/modules/booking/public/service";
import { kickOutbox } from "@/modules/notifications/service";

// Public booking (no session). Order matters: cheap limits first, then body validation, then the database decides conflicts.
export const POST = api<{ slug: string }>(async (req, { slug }) => {
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 128) throw fail("IDEMPOTENCY_KEY_REQUIRED", "חסר מפתח Idempotency-Key.");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) throw fail("NOT_FOUND", "לא נמצא."); // before any limiter row is written for a junk slug
  const ip = clientIp(req);
  await enforce([
    { scope: "book-ip", value: `${ip}|${slug}`, windowSeconds: 60, max: limitFromHeader(req, 10) },
    { scope: "book-biz", value: slug, windowSeconds: 60, max: 120 },
  ]);
  const catalog = await catalogOr404(slug);
  const input = parse(CreateBookingRequest, await readJson(req));
  const phone = normalizePhone(input.customer.phone);
  if (phone) await enforce([{ scope: "book-phone", value: `${phone}|${catalog.business.id}`, windowSeconds: 3600, max: 6 }]); // one customer cannot flood a business
  await enforce([emailLimit(req, input.customer.email)]); // the mailbox is the identity: it is limited like the phone, whatever way it is written
  const { booking, replay } = await createBooking(catalog, input, key);
  if (!replay) after(kickOutbox); // the e-mail goes out now; the cron is only the safety net
  return NextResponse.json({ booking }, { status: replay ? 200 : 201, headers: replay ? { "Idempotent-Replay": "true" } : {} });
}, { lab: false });
