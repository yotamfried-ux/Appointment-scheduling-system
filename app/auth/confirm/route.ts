import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Only same-site relative paths are allowed as the post-confirmation target (open-redirect guard, SEC-19).
function safeNext(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  return "/dashboard";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) redirect(next);
  }
  redirect("/auth/error?reason=expired");
}
