import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/safe-next";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));
  const code = searchParams.get("code");

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) redirect(next);
  }
  if (code) {
    // The mail came from Supabase's own template: Supabase has already verified the address and sent the browser back here with a one-time code, which only the browser that signed up can
    // exchange (it holds the matching secret). Any other browser or phone cannot, but the address IS verified, so it is sent to sign in instead of being told the link expired.
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) redirect(next);
    redirect("/auth/login?verified=1");
  }
  redirect("/auth/error?reason=expired");
}
