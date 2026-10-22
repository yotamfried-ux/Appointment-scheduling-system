"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { enforce } from "@/modules/booking/public/rate-limit";

export type EnrollResult = { ok: true; factorId: string; qr: string; secret: string } | { ok: false };
export type VerifyResult = { ok: true } | { ok: false };

const Code = z.string().regex(/^\d{6}$/);

/** A six-digit code has a million values: after 10 wrong tries in 5 minutes an account has to wait (Strix: the second factor could be guessed without limit). */
async function codeAttemptsLeft(supabase: Awaited<ReturnType<typeof createClient>>): Promise<boolean> {
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!sub) return false;
  try {
    await enforce([{ scope: "totp", value: String(sub), windowSeconds: 300, max: 10 }]);
    return true;
  } catch {
    return false;
  }
}

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
  if (!(await codeAttemptsLeft(supabase))) return { ok: false };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factorId.data, code: code.data });
  return error ? { ok: false } : { ok: true };
}

/** Login step 2: find the user's verified TOTP factor server-side (the client never chooses the factor id). */
export async function verifyLoginCodeAction(input: { code: unknown }): Promise<VerifyResult> {
  const code = Code.safeParse(input.code);
  if (!code.success) return { ok: false };
  const supabase = await createClient();
  if (!(await codeAttemptsLeft(supabase))) return { ok: false };
  const { data } = await supabase.auth.mfa.listFactors();
  const factor = data?.totp.find((f) => f.status === "verified");
  if (!factor) return { ok: false };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.data });
  return error ? { ok: false } : { ok: true };
}
