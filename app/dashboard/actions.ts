"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRequiredAssurance } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { TenancyErrorCode } from "@/modules/tenancy/errors";
import { publishBusiness } from "@/modules/tenancy/service";
import { sessionIsLive } from "@/lib/auth/live-session";

export async function publishAction(businessId: unknown): Promise<{ ok: true } | { ok: false; code: TenancyErrorCode }> {
  const id = z.uuid().safeParse(businessId);
  if (!id.success) return { ok: false, code: "VALIDATION" };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims || !(await sessionIsLive(supabase))) return { ok: false, code: "NOT_AUTHENTICATED" };
  if (!(await hasRequiredAssurance(supabase))) return { ok: false, code: "FORBIDDEN" };
  const r = await publishBusiness(supabase, id.data); // owner + verified email enforced in the database
  if (r.ok) revalidatePath("/dashboard");
  return r.ok ? { ok: true } : { ok: false, code: r.code };
}
