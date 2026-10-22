import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Is the session behind this cookie still alive on the Auth server?
 * `getClaims()` verifies the token's signature locally, so a token stays valid until it expires even after logout or a
 * password change (found by Strix on 2026-10-21). `getUser()` asks the Auth server, which refuses a revoked session.
 * Only an answer from the Auth server that the session is gone counts as "not live": if the server cannot be reached,
 * the signed token decides, as before.
 */
export async function sessionIsLive(supabase: { auth: Pick<SupabaseClient["auth"], "getUser"> }): Promise<boolean> {
  const { data, error } = await supabase.auth.getUser();
  if (data?.user) return true;
  const status = (error as { status?: number } | null)?.status;
  return !(typeof status === "number" && status >= 400 && status < 500);
}
