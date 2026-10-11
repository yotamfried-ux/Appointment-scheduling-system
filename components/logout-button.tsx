"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const t = useTranslations("nav");
  const router = useRouter();
  const logout = async () => {
    await createClient().auth.signOut();
    router.push("/auth/login");
    router.refresh();
  };
  return (
    <Button variant="outline" size="sm" onClick={logout}>
      {t("signOut")}
    </Button>
  );
}
