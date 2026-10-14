import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "./logout-button";

export async function AuthButton() {
  const t = await getTranslations("nav");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  return user ? (
    <div className="flex items-center gap-3">
      <Button asChild size="sm" variant="ghost">
        <Link href="/dashboard">{t("dashboard")}</Link>
      </Button>
      <LogoutButton />
    </div>
  ) : (
    <div className="flex items-center gap-2">
      <Button asChild size="sm" variant="ghost">
        <Link href="/auth/login">{t("signIn")}</Link>
      </Button>
      <Button asChild size="sm">
        <Link href="/auth/sign-up">{t("signUp")}</Link>
      </Button>
    </div>
  );
}
