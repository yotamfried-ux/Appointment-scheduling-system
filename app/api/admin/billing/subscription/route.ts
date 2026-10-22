import { NextResponse } from "next/server";
import { z } from "zod";
import { api, assertSameOrigin, fail, parse, readJson } from "@/lib/api/http";
import { hasRequiredAssurance } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { sessionIsLive } from "@/lib/auth/live-session";

// The `manual` provider's control surface: record what was agreed or paid outside the system. Same event path as any provider.
const Body = z.object({ businessId: z.string().uuid(), planId: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/), status: z.enum(["trialing", "active", "past_due", "canceled"]), periodEnd: z.string().datetime().nullable().optional(), reason: z.string().min(5).max(300) }).strict();

export const POST = api(async (req) => {
  assertSameOrigin(req);
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims || !(await sessionIsLive(supabase))) throw fail("UNAUTHENTICATED", "יש להתחבר מחדש.");
  if (!(await hasRequiredAssurance(supabase))) throw fail("UNAUTHENTICATED", "נדרש אימות דו-שלבי.");
  const b = parse(Body, await readJson(req));
  const { data: out, error } = await supabase.rpc("admin_manual_subscription", { p_business: b.businessId, p_plan: b.planId, p_status: b.status, p_period_end: b.periodEnd ?? null, p_reason: b.reason });
  if (error) throw fail(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_FAILED", "הפעולה נדחתה.");
  return NextResponse.json(out);
}, { lab: false });
