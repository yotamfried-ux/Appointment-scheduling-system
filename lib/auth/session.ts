import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { checkSession } from "@/lib/auth/live-session";
import { legalGateActive, missingAcceptances } from "@/lib/legal/gate";
import { createClient } from "@/lib/supabase/server";

/** Session + MFA gate for server components/actions. Memoized per request (React cache): a page and the helpers it calls share one check instead of repeating the Auth and database round trips. Users with a verified TOTP factor must be at aal2 (docs/05 §5.2). */
export const requireUser = cache(async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/auth/login");
  const gate = await checkSession(supabase, data.claims);
  if (!gate.live) redirect("/auth/login");
  if (!gate.secondFactor) redirect("/auth/mfa");
  // CMP-03: a new version of the terms or the privacy policy must be accepted before the owner area is used again.
  if ((await legalGateActive()) && (await missingAcceptances(supabase)).length > 0) redirect("/legal/accept");
  return { supabase, claims: data.claims };
});
