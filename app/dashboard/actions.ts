"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { TenancyErrorCode } from "@/modules/tenancy/errors";
import { publishBusiness } from "@/modules/tenancy/service";
import { checkSession } from "@/lib/auth/live-session";
import { legalAccepted } from "@/lib/legal/gate";

export async function publishAction(businessId: unknown): Promise<{ ok: true } | { ok: false; code: TenancyErrorCode }> {
  const id = z.uuid().safeParse(businessId);
  if (!id.success) return { ok: false, code: "VALIDATION" };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const gate = data?.claims ? await checkSession(supabase, data.claims) : null;
  if (!gate?.live) return { ok: false, code: "NOT_AUTHENTICATED" };
  if (!gate.secondFactor) return { ok: false, code: "FORBIDDEN" };
  if (!(await legalAccepted(supabase))) return { ok: false, code: "FORBIDDEN" }; // CMP-03 on actions too
  const r = await publishBusiness(supabase, id.data); // owner + verified email enforced in the database
  if (r.ok) revalidatePath("/dashboard");
  return r.ok ? { ok: true } : { ok: false, code: r.code };
}
