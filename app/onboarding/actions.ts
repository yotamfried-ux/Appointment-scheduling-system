"use server";

import { createClient } from "@/lib/supabase/server";
import { createBusiness } from "@/modules/tenancy/service";
import { CreateBusinessInput } from "@/modules/tenancy/schema";
import type { TenancyErrorCode } from "@/modules/tenancy/errors";
import { checkSession } from "@/lib/auth/live-session";
import { legalAccepted } from "@/lib/legal/gate";

export type CreateBusinessResult = { ok: true; slug: string } | { ok: false; code: TenancyErrorCode };

// Server Action: Next.js verifies Origin/Host for Server Actions (CSRF, SEC-05). The tenant is the session user:
// nothing about identity or slug is read from the request body.
export async function createBusinessAction(raw: unknown): Promise<CreateBusinessResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const gate = data?.claims ? await checkSession(supabase, data.claims) : null;
  if (!gate?.live) return { ok: false, code: "NOT_AUTHENTICATED" };
  if (!gate.secondFactor) return { ok: false, code: "FORBIDDEN" };
  if (!(await legalAccepted(supabase))) return { ok: false, code: "FORBIDDEN" }; // CMP-03 on actions too
  const parsed = CreateBusinessInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const r = await createBusiness(supabase, parsed.data);
  return r.ok ? { ok: true, slug: r.value.slug } : { ok: false, code: r.code };
}
