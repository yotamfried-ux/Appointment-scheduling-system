import { MailCheck } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";

export default async function Page() {
  const t = await getTranslations("auth.signUpSuccess");
  return (
    <AuthCard title={t("title")} description={t("description")}>
      <div className="flex items-start gap-3 rounded-lg bg-info-soft p-4 text-info-soft-foreground">
        <MailCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
        <p className="text-sm">{t("body")}</p>
      </div>
      <p className="text-sm text-muted-foreground">{t("tip")}</p>
      <Button asChild variant="outline" size="lg">
        <Link href="/auth/login">{t("toLogin")}</Link>
      </Button>
    </AuthCard>
  );
}
