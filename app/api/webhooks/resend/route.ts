import { NextResponse } from "next/server";
import { z } from "zod";
import { api, fail } from "@/lib/api/http";
import { addressHash } from "@/modules/notifications/config";
import { verifySvix } from "@/modules/notifications/svix";
import { systemDb } from "@/platform/system-db";

// Resend delivery webhooks (Svix-signed). Only a permanent bounce or a spam complaint stops mail to an address (NTF-05).
export const dynamic = "force-dynamic";

const Event = z.object({
  type: z.string(),
  data: z.object({
    email_id: z.string().optional(),
    to: z.array(z.string()).default([]),
    bounce: z.object({ type: z.string().optional() }).partial().optional(),
  }),
});

export const POST = api(async (req) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) throw fail("UNAVAILABLE", "השירות אינו מוגדר.");
  const body = await req.text(); // raw body: the signature covers the exact bytes
  const v = verifySvix({ secret, id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature"), body });
  if (!v.ok) throw fail("UNAUTHENTICATED", "אין הרשאה."); // one answer for every failure: nothing to learn from probing
  let parsed: z.infer<typeof Event>;
  try {
    parsed = Event.parse(JSON.parse(body));
  } catch {
    throw fail("BAD_REQUEST", "גוף הבקשה אינו תקין.");
  }
  const isHardBounce = parsed.type === "email.bounced" && parsed.data.bounce?.type === "Permanent";
  const isComplaint = parsed.type === "email.complained";
  if (isHardBounce || isComplaint) {
    for (const address of parsed.data.to) {
      const { error } = await systemDb().rpc("notif_suppress", { p_hash: addressHash(address), p_reason: isComplaint ? "complaint" : "bounce", p_message_id: parsed.data.email_id ?? null });
      if (error) throw new Error("suppress failed");
    }
  }
  return NextResponse.json({ ok: true });
}, { lab: false });
