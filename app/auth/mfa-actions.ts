"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type EnrollResult = { ok: true; factorId: string; qr: string; secret: string } | { ok: false };
export type VerifyResult = { ok: true } | { ok: false };

const Code = z.string().regex(/^\d{6}$/);

export async function enrollTotpAction(): Promise<EnrollResult> {
  const supabase = await createClient();
  if (!(await supabase.auth.getClaims()).data?.claims) return { ok: false };
  // Drop abandoned (never verified) factors so retries do not pile up.
  const { data: list } = await supabase.auth.mfa.listFactors();
  for (const f of list?.all ?? []) if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `auth-${Date.now()}` });
  if (error || !data) return { ok: false };
  return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyTotpAction(input: { factorId: unknown; code: unknown }): Promise<VerifyResult> {
  const code = Code.safeParse(input.code);
  const factorId = z.uuid().safeParse(input.factorId);
  if (!code.success || !factorId.success) return { ok: false };
  const supabase = await createClient();
  if (!(await supabase.auth.getClaims()).data?.claims) return { ok: false };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factorId.data, code: code.data });
  return error ? { ok: false } : { ok: true };
}

/** Login step 2: find the user's verified TOTP factor server-side (the client never chooses the factor id). */
export async function verifyLoginCodeAction(input: { code: unknown }): Promise<VerifyResult> {
  const code = Code.safeParse(input.code);
  if (!code.success) return { ok: false };
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const factor = data?.totp.find((f) => f.status === "verified");
  if (!factor) return { ok: false };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.data });
  return error ? { ok: false } : { ok: true };
}
