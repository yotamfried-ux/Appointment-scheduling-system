import { NextResponse } from "next/server";
import { z } from "zod";
import { api, assertSameOrigin, fail, parse, readJson } from "@/lib/api/http";
import { checkSession } from "@/lib/auth/live-session";
import { createClient } from "@/lib/supabase/server";

// Kill switch (docs/05 §5.11): a platform admin with a second factor takes a business's booking page down (or lifts that). The database checks the role; this route only carries the call.
const Body = z.object({ businessId: z.string().uuid(), suspended: z.boolean(), reason: z.string().min(5).max(300) }).strict();

export const POST = api(async (req) => {
  assertSameOrigin(req);
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const gate = data?.claims ? await checkSession(supabase, data.claims) : null;
  if (!gate?.live) throw fail("UNAUTHENTICATED", "יש להתחבר מחדש.");
  if (!gate.secondFactor) throw fail("UNAUTHENTICATED", "נדרש אימות דו-שלבי.");
  const b = parse(Body, await readJson(req));
  const { error } = await supabase.rpc("admin_set_suspension", { p_business: b.businessId, p_suspended: b.suspended, p_reason: b.reason });
  if (error) throw fail(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_FAILED", "הפעולה נדחתה.");
  return NextResponse.json({ ok: true });
}, { lab: false });
