import { redirect } from "next/navigation";
import { MfaLoginForm } from "@/components/auth/mfa-login-form";
import { createClient } from "@/lib/supabase/server";

export default async function Page() {
  const supabase = await createClient();
  if (!(await supabase.auth.getClaims()).data?.claims) redirect("/auth/login");
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!(aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2")) redirect("/dashboard"); // nothing to verify
  return <MfaLoginForm />;
}
