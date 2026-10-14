import { NextResponse } from "next/server";
import { z } from "zod";
import { api, assertSameOrigin, fail, parse, readJson } from "@/lib/api/http";
import { hasRequiredAssurance } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

// Back-office (BIL-09/SEC-10): the database decides who is a platform admin and requires MFA (aal2); this route only carries the call as the signed-in user.
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set"), businessId: z.string().uuid(), key: z.enum(["waitlist", "export", "max_services"]), bool: z.boolean().nullable().optional(), int: z.number().int().min(0).nullable().optional(), unlimited: z.boolean().optional(), reason: z.string().min(5).max(300), expiresAt: z.string().datetime().nullable().optional() }).strict(),
  z.object({ action: z.literal("remove"), businessId: z.string().uuid(), key: z.enum(["waitlist", "export", "max_services"]) }).strict(),
]);

export const POST = api(async (req) => {
  assertSameOrigin(req);
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) throw fail("UNAUTHENTICATED", "יש להתחבר מחדש.");
  if (!(await hasRequiredAssurance(supabase))) throw fail("UNAUTHENTICATED", "נדרש אימות דו-שלבי.");
  const b = parse(Body, await readJson(req));
  const { error } =
    b.action === "set"
      ? await supabase.rpc("admin_set_override", { p_business: b.businessId, p_key: b.key, p_bool: b.bool ?? null, p_int: b.int ?? null, p_unlimited: b.unlimited ?? false, p_reason: b.reason, p_expires: b.expiresAt ?? null })
      : await supabase.rpc("admin_remove_override", { p_business: b.businessId, p_key: b.key });
  if (error) throw fail(error.code === "42501" ? "FORBIDDEN" : error.code === "23514" ? "VALIDATION_FAILED" : "NOT_FOUND", "הפעולה נדחתה.");
  return NextResponse.json({ ok: true });
}, { lab: false });
