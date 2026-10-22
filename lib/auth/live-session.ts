import type { SupabaseClient } from "@supabase/supabase-js";

export interface SessionCheck {
  /** The Auth server still knows this session (not logged out, not revoked). */
  live: boolean;
  /** The account has no verified second factor, or this session has passed it (aal2). */
  secondFactor: boolean;
}

/**
 * What the session cookie says is not proof: `getClaims()` verifies only the token's signature, so a logged-out session keeps working until the
 * token expires, and the factor list inside the (unsigned) cookie can be edited so that the second-factor gate sees "no factors"
 * (Strix, 2026-10-21/22). Both are therefore decided by the Auth server: `getUser()` answers whether the session still exists and returns
 * the account's real factor list. Only the signed token's `aal` claim says whether this session passed the second factor.
 * If the Auth server cannot be reached nothing can be verified, so the answer is "not live": the owner area is closed rather than open.
 */
export async function checkSession(supabase: { auth: Pick<SupabaseClient["auth"], "getUser"> }, claims: { aal?: unknown } | null | undefined): Promise<SessionCheck> {
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return { live: false, secondFactor: false };
  const hasVerifiedFactor = (user.factors ?? []).some((f) => f.status === "verified");
  return { live: true, secondFactor: !hasVerifiedFactor || claims?.aal === "aal2" };
}
