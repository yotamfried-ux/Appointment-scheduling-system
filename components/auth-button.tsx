import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { checkSession } from "@/lib/auth/live-session";
import { LogoutButton } from "./logout-button";

export async function AuthButton() {
  const t = await getTranslations("nav");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  if (!user) {
    return (
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

  const gate = await checkSession(supabase, user).catch(() => null);
  if (!gate?.live) {
    return (
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

  return (
    <div className="flex items-center gap-3">
      <Button asChild size="sm" variant="ghost">
        <Link href="/dashboard">{t("dashboard")}</Link>
      </Button>
      <LogoutButton />
    </div>
  );
}
