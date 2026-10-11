import { timingSafeEqual } from "node:crypto";
import { fail } from "@/lib/api/http";

/** Cron/job endpoints: `Authorization: Bearer $CRON_SECRET` (what Vercel Cron sends). Fails closed when the secret is not configured. */
export function authorizeCron(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) throw fail("UNAVAILABLE", "השירות אינו מוגדר.");
  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) throw fail("UNAUTHENTICATED", "אין הרשאה.");
}
