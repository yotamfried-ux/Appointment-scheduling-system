import "server-only";
import { redirect } from "next/navigation";
import { legalGateActive, missingAcceptances } from "@/lib/legal/gate";
import { createClient } from "@/lib/supabase/server";

/** Session + MFA gate for server components/actions. Users with a verified TOTP factor must be at aal2 (docs/05 §5.2). */
export async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/auth/login");
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") redirect("/auth/mfa");
  // CMP-03: a new version of the terms or the privacy policy must be accepted before the owner area is used again.
  if ((await legalGateActive()) && (await missingAcceptances(supabase)).length > 0) redirect("/legal/accept");
  return { supabase, claims: data.claims };
}

/** For Server Actions: no redirect, just a boolean so the caller can answer with a typed error. */
export async function hasRequiredAssurance(supabase: Awaited<ReturnType<typeof createClient>>): Promise<boolean> {
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return !(aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2");
}
